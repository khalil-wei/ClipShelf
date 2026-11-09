use std::sync::{Condvar, Mutex};
#[derive(Default)]
struct Queue {
    issued: u64,
    next: u64,
    closed: bool,
}
#[derive(Default)]
pub struct Serial {
    queue: Mutex<Queue>,
    changed: Condvar,
}
pub struct Turn<'a>(&'a Serial);
impl Serial {
    pub fn issue(&self) -> Option<u64> {
        let mut queue = self.queue.lock().unwrap();
        if queue.closed {
            return None;
        }
        let ticket = queue.issued;
        queue.issued += 1;
        Some(ticket)
    }
    pub fn seal(&self) -> u64 {
        let mut queue = self.queue.lock().unwrap();
        queue.closed = true;
        queue.issued
    }
    pub fn wait(&self, ticket: u64) -> Turn<'_> {
        let mut queue = self.queue.lock().unwrap();
        while queue.next != ticket {
            queue = self.changed.wait(queue).unwrap();
        }
        Turn(self)
    }
}
impl Drop for Turn<'_> {
    fn drop(&mut self) {
        self.0.queue.lock().unwrap().next += 1;
        self.0.changed.notify_all();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_scheduling_cannot_reorder_accepted_mutations_or_exit_flush() {
        let gate = std::sync::Arc::new(Serial::default());
        let first = gate.issue().unwrap();
        let second = gate.issue().unwrap();
        let final_ticket = gate.seal();
        assert!(gate.issue().is_none());
        let worker_gate = gate.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _turn = worker_gate.wait(second);
            tx.send("second").unwrap();
        });
        {
            let _turn = gate.wait(first);
            assert!(rx.try_recv().is_err());
        }
        {
            let _turn = gate.wait(final_ticket);
            assert_eq!(rx.recv().unwrap(), "second");
        }
        worker.join().unwrap();
    }
}
