# GitPulse
chrome extension to measure and alert about archived repos
Here’s a polished draft of your **README.md** for *GitPulse*:


## 🚀 Overview

We’ve all been there: you open a promising new repository to explore, contribute, or file an issue… only to discover it’s a dead project. **GitPulse** saves you time by automatically checking repo activity and adding a visible banner to the top of a GitHub repository’s home page.


### metrics that can make a repo inactive
 - last closed PR 
 - some value (is archived )
 - opened PRs greater than blank

## ✨ Features

* 🏷️ **Archive Banner** – Instantly see if a repo is archived with a clear warning at the top.
* 🔍 **Activity Check** – Verify if a repo is still active based on your own configurable rules.
* ⚡ **Time Saver** – No more endless Google searches or wasted clicks into inactive projects.
* ⚙️ **Customizable** – Define thresholds and rules for what you consider "inactive."

## 📷 Preview

![GitPulse Icon](./src/icon.png)

*(Screenshot of banner coming soon)*

## 🛠️ Installation

1. Clone or download this repository.
2. Open **Chrome Extensions** (`chrome://extensions/`).
3. Enable **Developer Mode** (top right corner).
4. Click **Load unpacked** and select the project folder.
5. Done! The extension is now active.

## ⚡ Usage

* Navigate to any GitHub repository.
* If the repo is archived, GitPulse will display a banner on the repo’s home page.
* Configure activity rules in the extension’s settings.

## 📌 Roadmap

* [x] Add repo activity scoring system (commits, issues, PRs). IE go to repo page and log if active or archived
* [x] Banner to display status on the page. 
* [ ] Configurable rule system. settings pop up and editiable rules. 
* [x] web searches or even all github urls displayed also checked remotly. 
* [ ] Browser support beyond Chrome (Firefox, Edge).
* [x] Gitlab and npm and other repo systems maybe even docker ? 
* [ ] Dark mode support for the banner and settings system.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request if you’d like to improve GitPulse.

## 📜 License

[MIT](./LICENSE)
