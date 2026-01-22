![Version](https://img.shields.io/badge/version-1.7.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Chrome%20Extension-lightgrey)

# Controlled Queue Loader

Controlled Queue Loader is a Chrome extension designed to help users work through **large lists of URLs in a controlled, reliable, and stress-free way**.

Instead of opening dozens of tabs at once or losing track of progress, this extension introduces a **guided queue-based workflow** with clear task tracking and built-in safety mechanisms.

---

## Why this extension exists

When working with large sets of URLs (product pages, audits, reviews, research links):

- Opening everything at once overloads the browser
- It’s easy to forget which pages are already reviewed
- Accidental tab closures can break the workflow
- Progress tracking becomes unclear and error-prone

Controlled Queue Loader solves these problems by **controlling how URLs are opened, tracked, and completed**.

---

## What it does (simple explanation)

1. Paste a list of URLs (one per line)
2. Choose how many tabs can open at once
3. Start the queue
4. Work on each page
5. Click **Mark Done** when finished
6. The next URL loads automatically

You always know:
- What is active
- What is pending
- What is completed

---

## Key features

### Controlled tab concurrency
- Limits how many tabs open at the same time
- Prevents browser slowdown and tab overload
- User configurable (up to 6 tabs)

### Mark Done workflow
- Each task is explicitly marked as completed
- Prevents skipped or forgotten pages
- Automatically advances the queue

### Clear Queue (safe & confirmed)
- Clears pending tasks with confirmation
- Prevents accidental data loss
- Disabled automatically when there’s nothing to clear

### Automatic safety handling
- Handles accidental tab closures gracefully
- Optional setting to automatically mark tasks as done on close
- Prevents the queue from getting stuck

### Clear progress summary
- Displays:
  - Active tasks
  - Pending tasks
  - Completed tasks
  - Failed tasks
- Makes long workflows predictable and manageable

---

## Who is this useful for?

- Analysts reviewing large numbers of web pages
- QA, auditing, or content review workflows
- Product or listing verification tasks
- Anyone who wants structured progress instead of tab chaos

No technical knowledge is required to use the extension.

---

## How to use

1. Open the extension popup
2. Paste URLs (one per line)
3. Set the number of concurrent tabs
4. Click **Start**
5. Review pages and click **Mark Done**
6. Track progress in real time

---

## Design philosophy

This extension is intentionally:
- Simple
- Explicit
- User-driven
- Safe against common mistakes

It is designed around **real user behavior**, including interruptions, accidental actions, and long-running workflows.

---

## Technical overview (high level)

- Chrome Extension (Manifest V3)
- JavaScript
- Popup-based UI
- Background service worker
- State persistence using Chrome storage
- UX-first design approach

---

## Status

Actively maintained.  
Built and refined based on real usage feedback.

---

## Contributing

Contributions are welcome.  
Please see `CONTRIBUTING.md` for guidelines.

---

## License

MIT. See the `LICENSE` file for details.
