# Document registry: AIISV Intern Time Tracker

Last updated: Oct 1, 2026. Add a row whenever a document, file or account is created or changed.

## Project documents (this claude.ai project, `claude/` folder)
| # | Document | Path | Purpose | Version / date | Status |
|---|---|---|---|---|---|
| 00 | Start here | `claude/00_START_HERE.md` | Orientation and change procedure for future sessions | v1 · Oct 1, 2026 | Current |
| 01 | Document registry | `claude/01_Document_Registry.md` | This list | v1 · Oct 1, 2026 | Current |
| 02 | PRD and technical spec | `claude/02_PRD_and_Spec.md` | Requirements, architecture, data model, API, security, decisions | v1.0 · Oct 1, 2026 | Current |
| 03 | Setup and admin guide | `claude/03_Setup_and_Admin_Guide.md` | One-time setup steps, day-to-day menu actions, rules, emails, status | v1 · Oct 1, 2026 | Current (replaces `claude/Time_Tracker_Setup.md`) |

## Project library (`claude/library/`)
| Area | Files | Source of truth | Snapshot date |
|---|---|---|---|
| Code | `code/Code.gs`, `code/app.js`, `code/index.html`, `code/styles.css`, `code/config.js`, `code/CNAME`, `code/README.md` | GitHub `kkauf123/aiisv-time` | Oct 1, 2026 (commit after "Connect site to the Apps Script web app") |
| Sheet snapshots | `sheets/Roster.csv`, `Managers.csv`, `Entries.csv`, `Change_Log.csv`, `Unlocks.csv`, `Settings.csv`, `Sessions.csv` (tokens redacted) | Google Sheet ID `1HOt_71-EWBIOph8jTIcbYfqH1rutzZ7TraeraJ_qElY` | Oct 1, 2026, 1 PM |
| Original source files | `source/Original_Template_2026_Time_Entry.csv`, `source/Original_Workbooks.md` | Kent's uploads (Oct 1) | Oct 1, 2026 |
| Tests | `tests/unit.js`, `tests/mock.js`, `tests/signin.js`, `tests/e2e.js`, `tests/seed_entries.json`, `tests/README.md` | GitHub `kkauf123/aiisv-time/test` | Oct 1, 2026 |

## Live systems and accounts
| Asset | Location | Owner / account | Notes |
|---|---|---|---|
| Website | https://time.aiisv.org | GitHub kkauf123 (Pages) | HTTPS enforced |
| Code repo | https://github.com/kkauf123/aiisv-time | kkauf123 | Public. Code, anonymized tests and this registry only. The PRD lives only in the Claude project. |
| Data Sheet | https://docs.google.com/spreadsheets/d/1HOt_71-EWBIOph8jTIcbYfqH1rutzZ7TraeraJ_qElY/edit | assessmentaiisv@gmail.com | Private |
| Apps Script project "AIISV Time Tracker" | Bound to the Sheet | assessmentaiisv@gmail.com | Web app deployed: Execute as Me, Access Anyone |
| Web app endpoint | https://script.google.com/macros/s/AKfycbwkLnUgi4j99A9ZhV1dOW23AkNXO3CwRMRatB-wiBecE-87jj55wa762EE13ahMziFz/exec | — | Referenced in `config.js` |
| Time triggers | runDailyJobs (7 AM PT daily), runReminders (2 PM PT daily, acts on Fridays) | Apps Script | Installed by setup() |
| DNS record | aiisv.org: CNAME `time` → `kkauf123.github.io` | Kent | Added Oct 1 |
| Email sender | assessmentaiisv@gmail.com | — | Reports, reminders, links, sign-in codes |

## Change history
| Date | Change |
|---|---|
| Oct 1, 2026 | v1 built and launched. Sheet created, an intern's July hours imported, site and engine deployed, emailed-code sign-in added. Roster updated. |
