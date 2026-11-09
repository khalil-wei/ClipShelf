use crate::store::{ClipStore, Item};
use std::collections::HashSet;

#[derive(Clone)]
pub struct UndoRecord {
    pub before: ClipStore,
    pub after_ids: Vec<String>,
}

fn identity(item: &Item) -> (&str, &str) {
    match &item.image {
        Some(image) => ("image", &image.media_id),
        None => ("text", &item.text),
    }
}

impl UndoRecord {
    pub fn restore(&self, current: &ClipStore, now: f64) -> ClipStore {
        let after: HashSet<_> = self.after_ids.iter().collect();
        let new_copies: Vec<_> = current
            .items
            .iter()
            .filter(|item| !after.contains(&item.id))
            .collect();
        let new_content: HashSet<_> = new_copies.iter().map(|item| identity(item)).collect();
        let mut restored = self.before.clone();
        // 撤销只还原用户操作，后续采集及当前偏好、暂停状态必须保留。
        restored.items = new_copies
            .iter()
            .map(|item| (*item).clone())
            .chain(
                self.before
                    .items
                    .iter()
                    .filter(|item| !new_content.contains(&identity(item)))
                    .cloned(),
            )
            .take(2000)
            .collect();
        for item in &mut restored.items {
            item.groups
                .retain(|id| restored.groups.iter().any(|group| &group.id == id));
        }
        restored.settings = current.settings.clone();
        restored.paused = current.paused;
        restored.pause_until = current.pause_until;
        restored.resume_expired(now);
        restored
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn undo_keeps_new_copies_and_current_preferences() {
        let mut store = ClipStore::default();
        store.add("old", "", "", 1000.0);
        let before = store.clone();
        let id = store.items[0].id.clone();
        store.mutate("delete", &[id], None, 1000.0).unwrap();
        let record = UndoRecord {
            before,
            after_ids: Vec::new(),
        };
        store.add("new copy", "", "", 2000.0);
        store
            .mutate(
                "settings",
                &[],
                Some(&json!({"theme":"dark","shortcut":"Alt+V"})),
                2000.0,
            )
            .unwrap();
        store.mutate("pause", &[], None, 2000.0).unwrap();
        let restored = record.restore(&store, 2000.0);
        assert_eq!(
            restored
                .items
                .iter()
                .map(|item| item.text.as_ref())
                .collect::<Vec<_>>(),
            vec!["new copy", "old"]
        );
        assert_eq!(restored.settings.theme, "dark");
        assert_eq!(restored.settings.shortcut, "Alt+V");
        assert!(restored.paused);
    }

    #[test]
    fn recopy_after_delete_wins_over_the_old_identity() {
        let mut store = ClipStore::default();
        store.add("same", "old", "", 1000.0);
        let before = store.clone();
        store.items.clear();
        let record = UndoRecord {
            before,
            after_ids: Vec::new(),
        };
        store.add("same", "new", "", 2000.0);
        let new_id = store.items[0].id.clone();
        let restored = record.restore(&store, 2000.0);
        assert_eq!(restored.items.len(), 1);
        assert_eq!(restored.items[0].id, new_id);
        assert_eq!(restored.items[0].source, "new");
    }

    #[test]
    fn undo_does_not_keep_membership_in_a_reverted_group() {
        let mut store = ClipStore::default();
        let before = store.clone();
        store
            .mutate("group-add", &[], Some(&json!("temporary")), 1000.0)
            .unwrap();
        let group_id = store.groups[0].id.clone();
        let record = UndoRecord {
            before,
            after_ids: Vec::new(),
        };
        store.add("new", "", "", 1000.0);
        store
            .mutate(
                "group-set",
                &[store.items[0].id.clone()],
                Some(&json!(group_id)),
                1000.0,
            )
            .unwrap();
        let restored = record.restore(&store, 1000.0);
        assert!(restored.groups.is_empty());
        assert!(restored.items[0].groups.is_empty());
    }
}
