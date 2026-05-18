# Codex Notes

## GitHub publishing

Repository: https://github.com/maptap123/Coles-Bike

Local Git is not reliable in this workspace:

- The workspace `.git` folder has a Windows deny-write ACL, so normal `git add` and `git commit` can fail with `index.lock` permission errors.
- Local Windows Git may also fail to push with missing GitHub credentials.

For future Codex chats, prefer publishing changes to `maptap123/Coles-Bike` through the GitHub connector/API, then verify the remote commit or remote file contents afterward.
