use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, path::Path};

#[repr(C)]
struct Blob {
    len: u32,
    data: *mut u8,
}
#[link(name = "crypt32")]
unsafe extern "system" {
    fn CryptProtectData(
        input: *const Blob,
        description: *const u16,
        entropy: *const Blob,
        reserved: usize,
        prompt: usize,
        flags: u32,
        output: *mut Blob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *const Blob,
        description: usize,
        entropy: *const Blob,
        reserved: usize,
        prompt: usize,
        flags: u32,
        output: *mut Blob,
    ) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(memory: *mut u8) -> usize;
}

fn dpapi(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    let len = u32::try_from(bytes.len()).map_err(|_| "加密数据过大")?;
    let input = Blob {
        len,
        data: bytes.as_ptr().cast_mut(),
    };
    let mut output = Blob {
        len: 0,
        data: std::ptr::null_mut(),
    };
    // 不允许系统弹出凭据 UI；DPAPI 失败必须中止，不能降级明文。
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                0,
                0,
                1,
                &mut output,
            )
        } else {
            CryptUnprotectData(&input, 0, std::ptr::null(), 0, 0, 1, &mut output)
        }
    };
    if ok == 0 {
        return Err("Windows 本地加解密失败，已保留原文件".into());
    }
    let result = unsafe { std::slice::from_raw_parts(output.data, output.len as usize).to_vec() };
    unsafe {
        std::ptr::write_bytes(output.data, 0, output.len as usize);
        LocalFree(output.data);
    }
    Ok(result)
}

pub fn encrypt(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut output = b"CSRS01".to_vec();
    output.extend(dpapi(bytes, true)?);
    Ok(output)
}

pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(
        bytes
            .strip_prefix(b"CSRS01")
            .ok_or("历史格式不支持，已保留原文件")?,
        false,
    )
}

pub struct LegacyCodec {
    key: Vec<u8>,
}
impl Drop for LegacyCodec {
    fn drop(&mut self) {
        self.key.fill(0);
    }
}
impl LegacyCodec {
    pub fn open(directory: &Path) -> Result<Self, String> {
        let bytes =
            fs::read(directory.join("Local State")).map_err(|_| "旧版密钥文件缺失，无法导入")?;
        let state: serde_json::Value =
            crate::utf16::legacy_json(&bytes).map_err(|_| "旧版密钥文件无效")?;
        let encoded = state
            .get("os_crypt")
            .and_then(|v| v.get("encrypted_key"))
            .and_then(|v| v.as_str())
            .ok_or("旧版密钥缺失")?;
        let wrapped = STANDARD.decode(encoded).map_err(|_| "旧版密钥编码无效")?;
        let key = dpapi(
            wrapped.strip_prefix(b"DPAPI").ok_or("旧版密钥格式不支持")?,
            false,
        )?;
        if key.len() != 32 {
            return Err("旧版密钥长度无效".into());
        }
        Ok(Self { key })
    }
    pub fn decrypt(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        // Electron 42 的 v10 为 nonce + 密文 + tag，DPAPI 只保护 Local State 的密钥。
        if bytes.len() < 31 || !bytes.starts_with(b"v10") {
            return Err("旧版密文格式不支持".into());
        }
        Aes256Gcm::new_from_slice(&self.key)
            .map_err(|_| "旧版密钥无效")?
            .decrypt(Nonce::from_slice(&bytes[3..15]), &bytes[15..])
            .map_err(|_| "旧版密文认证失败，已保留原文件".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_encryption_authenticates_and_roundtrips() {
        let data = "合成数据 student@example.com".as_bytes();
        let encoded = encrypt(data).unwrap();
        assert_ne!(encoded, data);
        assert_eq!(decrypt(&encoded).unwrap(), data);
        let mut damaged = encoded;
        *damaged.last_mut().unwrap() ^= 1;
        assert!(decrypt(&damaged).is_err());
        assert!(decrypt(b"plain").is_err());
    }
}
