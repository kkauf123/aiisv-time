# AIISV Intern Time Tracker

Site for **https://time.aiisv.org**: interns log hours one week at a time; managers and admins see a dashboard.

- `index.html`, `app.js`, `styles.css`, `logo.png`: the page (GitHub Pages)
- `config.js`: the Apps Script web app URL the page talks to
- `engine/Code.gs`: the Apps Script engine. A copy lives in the **AIISV Intern Time Tracker** Google Sheet (assessmentaiisv@gmail.com) under Extensions → Apps Script. This file is the reference copy.

Data, the roster, the change log and settings all live in that Google Sheet. Each person opens the site through a private link (`?t=…`) that the Sheet's **Time Tracker** menu emails to them.
