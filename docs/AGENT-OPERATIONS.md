# Pi Agent — short operational guide

1. The panel is read-only. Select the intended machine/workspace, then **OpenSpec**.
2. Search/filter/sort and summary cover only loaded changes (40 maximum), not the whole project.
3. Select a change and Proposal/Design/Specs/Tasks. Filter tasks without editing them.
4. Archive is loaded only when selected. No restore or archive-write action exists.
5. **Check all loaded changes** is a limited local structural check, not CLI validation.
   Stop prevents further checks; an already shared read may finish. Use OpenSpec CLI separately
   when full validation is required. Unknown is never zero or a successful validation.
6. Refresh after external edits; visible active panels also poll every 60 seconds. A stale warning
   means the latest probe failed. Requests settle within 15 seconds including queue time;
   scans have a 60-second deadline.
7. Develop in a separate worktree. Never build, checkout, edit or switch the installed development
   checkout. Never repoint the live plugin symlink for testing. Use `scripts/isolated-host.mjs`
   and synthetic projects with distinct data/config/agent/socket/port paths.
8. Merge, final tag, npm publication and production deployment need separate explicit approval.
   Never restart the hosting daemon to activate this browser-only plugin; reload the browser.
9. Keep user conversations/private project data out of screenshots, fixtures, packages and reports.

Technical procedures: [Development](DEVELOPMENT.md), [Release](RELEASE.md),
[PUCP integration](PUCP-INTEGRATION.md), [consolidation evidence](CONSOLIDATION.md).
