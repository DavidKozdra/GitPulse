# GitPulse
a chrome extension to inform users of the activity of repo links before you click them. 


## 🚀 Overview

We’ve all been there: you open a promising new repository to explore, contribute, or file an issue… only to discover it’s a dead project. **GitPulse** saves you time by automatically checking repo activity and adding a visible banner to the top of a GitHub repository’s home page.


https://chromewebstore.google.com/detail/gitpulse/fiamhceclfnbckgpnmpkhldgbdhiamhg

### metrics that can make a repo inactive
 - last closed PR 
 - some value (is archived )
 - opened PRs greater than blank

## ✨ Features

* 🏷️ **Archive Banner** – Instantly see if a repo is archived with a clear warning at the top.
* 🔍 **Activity Check** – Verify if a repo or package is still active based on your own configurable rules.
* ⚡ **Time Saver** – No more endless Google searches or wasted clicks into inactive projects.
* ⚙️ **Customizable** – Define thresholds and rules for what you consider "inactive."
* 🧭 **Multi-host support** – Checks GitHub, Codeberg, GitLab, Bitbucket, npm, Docker Hub, PyPI, crates.io, Packagist, SourceHut, and Launchpad links.
* 📋 **Status details** – Shows why a repo or package was marked active, inactive, private, rate-limited, or unsupported.

## 📷 Preview

![GitPulse Icon](./src/icon.png)

<img width="2473" height="1394" alt="image" src="https://github.com/user-attachments/assets/1c9f7526-70db-46fa-9d4e-8b5da46d1996" />

<img width="1194" height="1423" alt="image" src="https://github.com/user-attachments/assets/5907153e-cdd2-429b-8e0d-b29e246f3bd8" />

<img width="2467" height="906" alt="image" src="https://github.com/user-attachments/assets/b224269f-3f94-4b53-9d6c-4e6c16bcbd72" />

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
* [X] Configurable rule system. settings pop up and editiable rules. 
* [x] web searches or even all github urls displayed also checked remotly. 
* [x] Browser support beyond Chrome (Firefox, Edge).
* [x] Gitlab and npm and other repo systems maybe even docker ? 
* [X] Dark mode support for the banner and settings system.

-- Product is considered in a final released state 

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request if you’d like to improve GitPulse.

## 📜 License

Free for all to use 

## CI/CD (Store publishing)

When you push to `main` with a `manifest.json` version bump, GitHub Actions can automatically build and publish the new package(s) to the extension stores.

- Workflow: [.github/workflows/publish.yml](.github/workflows/publish.yml)
- Always uploads `dist/*.zip` as artifacts.
- Publishes to stores only when the required secrets are configured.

**Chrome Web Store secrets**

- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

**Firefox AMO secrets**

- `FIREFOX_API_KEY`
- `FIREFOX_API_SECRET`
