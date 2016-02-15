# squirrel-server
An update server for Squirrel (Squirrel.Mac / Squirrel.Windows) write in Node.js, specifically for Electron.

[![Deploy](https://www.herokucdn.com/deploy/button.png)](https://heroku.com/deploy)

## Electron Auto-Updater
To connect your Electron application to `squirrel-server`, simple set your feed url path to `/update/:platform/:arch/:currentVersion`.
The same feed url will work for both Windows and Mac. At the moment, Linux is not supported in Electron.

### Example
```js
const { autoUpdater }	= require('electron');
const { version }		= require('./package.json');

const feedUrl = `http://example.com/update/${process.platform}/${process.arch}/${version}`;

autoUpdater.setFeedURL(feedUrl);
```

## Basic Setup
When you set up your `squirrel-server`, the only required Environment Variable is `GITHUB_REPO`. All others are optional, but certain features may not work unless they are enabled.

```bash
# `Username/Repository`
GITHUB_REPO="Tiliq/squirrel-server"
```

## Private GitHub Repositories
[Create a GitHub Token](https://github.com/settings/tokens/new) for your account with the `repo` scope selected and export an Environment Variable called `GITHUB_TOKEN` with the value.

```bash
GITHUB_TOKEN="Sup3rS3cr3tT0k3n"
```

## GitHub Release Webhook
Create a webhook on your repository that links to the `/webhook` path of your server. Every time you publish a new release, GitHub will ping the URL, causing the server to refresh it's data.

### Webhook Timeout
You may optionally specify how many seconds to wait after a ping before the server fetches data using `WEBHOOK_FETCH_TIMEOUT`. This is not recommended, as it's best to upload all artifacts before publishing a release.

```bash
# Wait 5 Seconds after publishing a new release
WEBHOOK_FETCH_TIMEOUT=5

# Fetch new information immediately
WEBHOOK_FETCH_TIMEOUT=0
```

## Auto-Updater

### Auto-Updater for Mac
###### Endpoint URL: `/update/darwin/x64/:currentVersion`
Requires `DARWIN_ZIP_FILE` Environment Variable.

```bash
DARWIN_ZIP_FILE="App-darwin-x64.zip"
```

If an update is available (the latest published release version is greater than `:currentVersion`), then this endpoint will return an object with information on the release. Otherwise, an HTTP status code `204` (No Content) will be returned.

Example Response:
```json
{
	"url": "http://example.com/download/v1.1.0/App-darwin-x64.zip",
	"link": "https://github.com/SquirrelServer/example/releases/tag/v1.1.0",
	"name": "Example App",
	"notes": "Release Notes",
	"pub_date": "2016-03-25T13:50:42Z"
}
```

### Auto-Updater for Windows
###### Endpoint URL: `/update/win32/:arch/:currentVersion`
###### Sub-Endpoint URL: `/update/win32/:arch/:currentVersion/RELEASES`
###### Sub-Endpoint URL: `/update/win32/:arch/:currentVersion/*-delta.nupkg`
###### Sub-Endpoint URL: `/update/win32/:arch/:currentVersion/*-full.nupkg`
Requires `WIN32_RELEASES_FILE` and `WIN32_NUPKG_FILE` Environment Variables.

```bash
# `{{arch}}` and `{{filename}}` will automatically get
# replaced based on the value in the Sub-Endpoint URL.
WIN32_RELEASES_FILE="{{arch}}-RELEASES"
WIN32_NUPKG_FILE="{{arch}}-{{filename}}"
```

If the **Endpoint URL** is accessed directly, a 404 will occur.

Electron's auto-updater (Squirrel.Windows) gets the **Endpoint URL** and appends `/RELEASES` to it which contains a list of NuPKG files. If an update is not available, all Sub-Endpoint URLs will return an HTTP status code `204` (No Content).

## Download files directly
Apart from this being an auto-update server, you may also request specific files for all of your platforms, architectures, and versions.

```bash
wget http://example.com/download/latest/App-linux-x64.zip
```

### Direct Download Endpoints

###### URL: `/download/latest/:platform/:arch`
Requires `LINUX_DIRECT_FILE`, `DARWIN_DIRECT_FILE`, and/or `WIN32_DIRECT_FILE` in order to correctly retrieve file.

Redirects to `/download/:version/:platform/:arch`, specifying `:version` using the latest published tag.

```bash
wget http://example.com/download/latest/darwin/x64
```

###### URL: `/download/:version/:platform/:arch`
Requires `LINUX_DIRECT_FILE`, `DARWIN_DIRECT_FILE`, and/or `WIN32_DIRECT_FILE` in order to correctly retrieve file.

```bash
# `{{arch}}` and `{{version}}` will automatically
# get replaced based on the value in the Endpoint URL.
LINUX_DIRECT_FILE="App-linux-{{arch}}-{{version}}.zip"
DARWIN_DIRECT_FILE="App-darwin-x64.dmg"
WIN32_DIRECT_FILE="{{arch}}-AppSetup.exe"
```

Redirects to `/download/:version/:filename`, specifying `:filename` using the environment variables to specify the filename.

```bash
wget http://example.com/download/v1.0.0/darwin/x64
```

###### URL: `/download/latest/:filename`
Redirects to `/download/:version/:filename`, specifying `:version` using the latest published tag.

```bash
wget http://example.com/download/latest/AppSetup.exe
```

###### URL: `/download/:version/:filename`
Downloads the specified filename and the specified version (tag name).

```bash
wget http://example.com/download/v1.0.0/AppSetup.exe
```

## API Endpoints

###### URL: `/api/resolve`
*Optional Query Parameters:*
- `platform` - `darwin`, `win32`, `linux`
- `arch` - `ia32`, `x64`

Attempts to resolve the platform, architecture, and download url best suited for the current user based on the `User-Agent`.
Platform (`platform`) and/or architecture (`arch`) may be passed through instead of attempting to "guess".

Example Responses:
```json
// wget http://example.com/api/resolve
{
	"platform": "darwin",
	"arch": "x64",
	"url": "http://example.com/download/latest/darwin/x64"
}

// wget http://example.com/api/resolve?platform=win32
{
	"platform": "win32",
	"arch": "x64",
	"url": "http://example.com/download/latest/win32/x64"
}

// wget http://example.com/api/resolve?platform=linux&arch=ia32
{
	"platform": "linux",
	"arch": "ia32",
	"url": "http://example.com/download/latest/linux/ia32"
}
```

###### URL: `/api/versions`
Returns a JSON array of release tag names

Example Response:
```json
{
	"versions": ["v1.0.0", "v1.1.0", "v1.1.1"]
}
```

###### URL: `/api/version/latest`
Redirects to `/api/version/:version`, specifying `:version` using the latest published tag.

###### URL: `/api/version/:version`
Returns a JSON object with information on the current release and asset information for the release.

Example Response:
```json
{
	"version": "v1.0.0",
	"link": "http://github.com/Username/Repo/release/v1.0.0",
	"name": "First Stable Release",
	"notes": "Wooo!",
	"pub_date": "2016-03-25T13:50:42Z",
	"files": [
		{
			"name": "AppSetup.zip",
			"url": "http://example.com/download/v1.0.0/AppSetup.zip",
			"label": "AppSetup.zip",
			"content_type": "application/zip",
			"size": 28566258,
			"download_count": 4
		},
		{
			"name": "App-darwin.zip",
			"url": "http://example.com/download/v1.0.0/App-darwin.zip",
			"label": "App-darwin.zip",
			"content_type": "application/zip",
			"size": 39523293,
			"download_count": 22
		}
	]
}
```

## Environment Variable Replacement Tags
The Environment Variables pertaining to the **Auto-Updater** and **Direct Download** endpoints are capable of mustache-style replacement tags.

|  Environment Variable |                                 Description                                 |  Replacement Tags  |                               Used By                               |
|:---------------------:|:---------------------------------------------------------------------------:|:------------------:|:-------------------------------------------------------------------:|
|  `LINUX_DIRECT_FILE`  |         The filename for Linux file across releases (usually a Zip)         |  `arch`, `version` | `/download/latest/linux/:arch`<br/>`/download/:version/linux/:arch` |
|  `DARWIN_DIRECT_FILE` |      The filename for Mac file across releases (usually a DMG or Zip)       |      `version`     |  `/download/latest/darwin/x64`<br/>`/download/:version/darwin/x64`  |
|   `DARWIN_ZIP_FILE`   |               The filename for Mac Zip files across releases                |                    |                 `/update/darwin/x64/:currentVersion`                |
| `WIN32_RELEASES_FILE` |         The filename for the Windows RELEASES file across releases          |       `arch`       |            `/update/win32/:arch/:currentVersion/RELEASES`           |
|   `WIN32_NUPKG_FILE`  |            The filename for Windows NuPKG files across releases             | `arch`, `filename` |           `/update/win32/:arch/:currentVersion/:filename`           |
|  `WIN32_DIRECT_FILE`  | The filename for Windows file across releases (usually an EXE, MSI, or Zip) |  `arch`, `version` | `/download/latest/win32/:arch`<br/>`/download/:version/win32/:arch` |

## FAQ

### What if I have two or more possible files for the same platform and architecture?
###### Example 1: `Setup.exe` and `Setup.msi`
###### Example 2: `app-linux.deb` and `app-linux.rpm` and `app-linux.zip`
Set your environment variable to include a custom `{{ext}}` replacement tag, then when you request the file using the appropriate `/download/:version/:platform/:arch` endpoint, specify `ext` as a query parameter.

```bash
LINUX_DIRECT_FILE="app-linux.{{ext}}" WIN32_DIRECT_FILE="Setup.{{ext}}" npm start
```

```bash
wget http://example.com/download/latest/linux/x64?ext=rpm
wget http://example.com/download/v1.0.0/win32/ia32?ext=msi
```

### How can I add two RELEASES files, one for `x64` and one for `ia32`?
Set your `WIN32_RELEASES_FILE` environment variable to include the `{{arch}}` replacement tag and rename your RELEASES files accordingly.

```bash
# Have x64-RELEASES and ia32-RELEASES uploaded
WIN32_RELEASES_FILE="{{arch}}-RELEASES" npm start
```

```bash
wget http://example.com/update/win32/x64/v1.0.0/RELEASES
wget http://example.com/update/win32/ia32/v1.0.0/RELEASES
```

### The filename includes the version number which is standard. How can I configure the server to find it properly?
Set your Environment Variable to include the `{{version}}` replacement tag.

```bash
LINUX_DIRECT_FILE="app-{{version}}-linux-{{arch}}.zip"
```

```bash
wget http://example.com/download/latest/linux/ia32
```

### How should I tag my releases?
Valid [SemVer](http://semver.org/) version is required to properly match and compare versions.

### How much disk space or memory should I establish for the machine?
The smallest amount should be fine in most cases. `squirrel-server` does not download files, stream files, or store files. This saves the machine from having to worry about disk space and memory. `squirrel-server` works by finding where GitHub stores your file (on S3) and merely redirects all downloads to that location, using one-time use tokens if necessary (if using a private repo).
