# Publishing Deckarr

How to get Deckarr into Unraid's Apps tab. You do steps 1 to 6 once; releases after that are step 7.

## 1. Fill in your details

Replace these placeholders in all files. In VS Code: **Ctrl+Shift+H** (Replace in Files).

| Placeholder | Replace with | Found in |
| --- | --- | --- |
| `YOUR_GITHUB_USERNAME` | Your GitHub username **in lowercase** (container image names must be lowercase) | `templates/deckarr.xml`, `ca_profile.xml`, `README.md`, `docker-compose.yml` |
| `YOUR_NAME` | Your name or handle | `LICENSE` |

## 2. Create the GitHub repository

1. On GitHub, create a **public** repository named `deckarr`. Don't add a README or license; they're already here.
2. Upload everything in this folder, keeping the structure (GitHub Desktop is easiest), including the hidden `.github`, `.gitattributes`, `.gitignore` and `.dockerignore`.

```bash
git init -b main
git add .
git commit -m "Deckarr 1.1.0"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/deckarr.git
git push -u origin main
```

Pushing to `main` builds an `:edge` image. Watch it under the **Actions** tab.

## 3. Publish the first release

Create a version tag. This builds `:latest` and `:1.1.0` for amd64 and arm64:

```bash
git tag v1.1.0
git push origin v1.1.0
```

Or on GitHub: **Releases > Draft a new release > Choose a tag > `v1.1.0` > Publish release**.

## 4. Make the image public

Go to your GitHub profile > **Packages** > **deckarr** > **Package settings**. If **Danger Zone** shows the visibility as Private, change it to **Public**. Unraid can't download a private image.

Check it from any machine:

```bash
docker pull ghcr.io/YOUR_GITHUB_USERNAME/deckarr:latest
```

## 5. Test the template on your own server

Remove your current hand-built `deckarr` container first (Docker tab > Deckarr icon > Remove). Your settings in appdata are kept if you use the same folder.

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-Deckarr.xml \
  https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/deckarr/main/templates/deckarr.xml
```

Then **Docker > Add Container > Template: Deckarr > Apply**, open the WebUI and check that everything works.

> The old setup used `/mnt/user/appdata/deckarr/config`. The template uses `/mnt/user/appdata/deckarr`. To keep your settings, either change the Appdata path in the template to `/mnt/user/appdata/deckarr/config`, or move `config.json` and `auth.json` up one folder.

## 6. Submit to Community Applications

1. Go to <https://ca.unraid.net/submit/new> and sign in with your Unraid account.
2. Enter your repository URL: `https://github.com/YOUR_GITHUB_USERNAME/deckarr`.
3. Run **Validate** and **Scan**. Fix anything it reports, push, and run them again.
4. **Submit**. After review, Deckarr shows up in the Apps tab for everyone.

Optional but appreciated by users: create a support thread in the Unraid forums (*Docker Containers* section) and put its link in `<Support>` in `templates/deckarr.xml`.

## 7. Releasing an update

Releases are automatic once the change reaches `main`:

1. Make your changes on the `test` branch. Every push there publishes `ghcr.io/bjaane/deckarr:test` for trying it out.
2. Bump `version` in `package.json` and `CACHE` in `public/sw.js`.
3. Add a `## X.Y.Z` section at the top of `CHANGELOG.md`.
4. Run `node scripts/sync-template.mjs`. It copies the newest changelog sections into `<Changes>` in `templates/deckarr.xml` and updates `<Date>`, which is what the Apps tab in Unraid shows.
5. Merge `test` into `main` with a pull request.

The Release workflow then creates the `vX.Y.Z` tag and GitHub release and builds `:latest`, `:X.Y.Z` and `:X.Y`. Unraid servers show **Update ready** on the Docker tab, and Community Applications picks up the new template text the next time it refreshes its app list (usually within a few hours).
