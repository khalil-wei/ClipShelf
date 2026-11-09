; Required program files cannot be skipped while reporting a successful install.
AllowSkipFiles off

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 clipshelf_install_incomplete
  IfFileExists "$INSTDIR\WebView2Loader.dll" 0 clipshelf_install_incomplete
  Goto clipshelf_install_verified
  clipshelf_install_incomplete:
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "Installation incomplete: required program files are missing."
    Quit
  clipshelf_install_verified:
!macroend
