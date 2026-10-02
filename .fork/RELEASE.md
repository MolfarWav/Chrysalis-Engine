# Releasing Molfar Vertep

Fork-only. The version line is the fork's own (0.1.0, 0.2.0, ...), independent of upstream's 1.0.x.

## Steps
1. **Pick the number.** A significant change is a minor bump (0.1.0 -> 0.2.0); a small fix is a patch (0.1.0 -> 0.1.1).
2. **Checks pass** on the branch: `bun run typecheck`, `bun run test` (the known Windows-only failures are listed in `.fork/STATE.md`), `bun run build:client`.
3. **Bump `package.json` `version` before the tag.** Update checks compare the release's `tag_name` (a leading `v` is dropped) with this version; a mismatch makes every copy offer the update forever, and `release.yml` refuses a tag that does not match.
4. **CHANGELOG.md:** rename `## Unreleased` to `## X.Y.Z (YYYY-MM-DD)` and start a new empty `## Unreleased` above it.
5. **Release notes:** write `.fork/release-notes/X.Y.Z.md`, the body of the GitHub release. `release.yml` uses it; without it GitHub generates notes from commits. It is a full, correct preview for users, not a copy of the CHANGELOG (the user's rule, 2026-10-02):
   - First half: every change that improves play, the UI or the agent, each under its own large heading with an emoji (`### 🔄 Updates in one place`), explained in plain words: what the user sees, what it does for them, what changed from before. Include what the release brings through app updates (Roleplay versions), and say how to get those.
   - Then `## 🛠️ Fixes` for user-visible bug fixes.
   - Then `## Other changes`: minor and technical items, one line each.
   - End with how to get it (source, downloads, app updates) and a link to CHANGELOG.md.
   - Every claim checked against the code or the app's CHANGELOG; nothing that ships later.
   - Written in English (GitHub release pages are English; the user's rule, 2026-10-02).
6. **Main:** the release is built only from a tag on `main`. Fast-forward main to the release commit: `git push origin HEAD:main` (main must be an ancestor of the branch; merge first if it is not).
7. **The tag (the user does this, the session proxy cannot push tags):** from a terminal in the engine folder:
   ```
   git fetch origin
   git tag vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```
   Push only the tag. Do NOT create the release in GitHub's "Draft a new release" form: the workflow creates the release itself, and a release that already exists makes it fail.
8. **The workflow** (`.github/workflows/release.yml`, tags `v*`): checks the tag matches `package.json` and sits on main, builds `Chrysalis-<version>-<target>` archives (names stay upstream's: `self-update.ts` matches `Chrysalis-*`), publishes the release as "Molfar.Vertep X.Y.Z" with the notes file. The Docker image step runs only in the upstream repository. npm publishing runs only when an `NPM_TOKEN` secret exists (the fork has none).
9. **Verify:** the release page lists the archives; Settings > Server (or the Updates panel) on an older copy offers the new version.

## One-time setup
- GitHub keeps a fork's workflows disabled until the owner enables them: repository > Actions tab > "I understand my workflows, go ahead and enable them". Until then nothing builds (0.1.0 has no archives for this reason and because its tag had no `v`).

## Keep apart
- `APP_API_VERSION` (`src/install.ts`) is the upstream app contract this engine keeps (1.0.2). Apps check their `engine` range against it, not against the fork version. Raise it only when an upstream merge changes the app contract.
- The tag `0.1.0` (no `v`) stays as it is; update checks and the launcher accept both forms.
