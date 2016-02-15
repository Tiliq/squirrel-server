'use strict';

const app		= require('koa')();
const body		= require('koa-buddy');
const router	= require('koa-router')();
const semver	= require('semver');
const https		= require('https');
const url		= require('url');
const version	= require('./package.json').version;
const userAgent = `Squirrel-Server (v${version})`;

const regexps = {
	x64: /(?:(amd|x(?:(?:86|64)[_-])?|wow|win)64)[;\)]/,
	ia32: /ia32(?=;)|(?:i[346]|x)86[;\)]/,
	win32: /windows/,
	darwin: /macintosh|mac\sos\sx/,
	linux: /linux|debian|ubuntu|fedora|centos|redhat/
};

let releases, auth;

if (process.env.GITHUB_TOKEN) {
	auth = process.env.GITHUB_TOKEN + ':';
}

function getAllReleases(page, tmp) {
	return new Promise((resolve, reject) => {
		page = page || 1;

		const options = {
			auth,
			hostname: 'api.github.com',
			path: `/repos/${process.env.GITHUB_REPO}/releases?page=${page}`,
			headers: {
				'User-Agent': userAgent
			}
		};

		const req = https.request(options, res => {
			let data = '';

			res.setEncoding('utf8');
			res.on('data', str => data += str);
			res.on('end', () => resolve({
				link: res.headers.link,
				data: JSON.parse(data).filter(r => !r.draft && !r.prerelease)
			}));
		});

		req.on('error', e => reject(e));
		req.end();
	}).then(data => {
		tmp = tmp || [];
		tmp.push(...data.data);

		if (/<([^>]+)>;\s*?rel="next"/.test(data.link)) {
			return getAllReleases(++page, tmp);
		} else {
			releases = tmp;
		}
	});
}

function processFilename(filename, vars) {
	for (let key in vars) {
		filename = filename.replace(`{{${key}}}`, vars[key]);
	}

	return filename;
}

function getReleaseVersionFromAsset(filename) {
	for (let i = 0, l = releases.length; i < l; i++) {
		const assets = releases[i].assets;

		for (let j = 0, m = assets.length; j < m; j++) {
			if (assets[j].name === filename) {
				return releases[i].tag_name;
			}
		}
	}
}

function getAssetFromReleaseVersion(version, filename) {
	for (let i = 0, l = releases.length; i < l; i++) {
		if (semver.neq(releases[i].tag_name, version)) {
			continue;
		}

		const assets = releases[i].assets;

		for (let j = 0, m = assets.length; j < m; j++) {
			if (assets[j].name === filename) {
				return url.parse(assets[j].url);
			}
		}
	}
}

function getAssetUrl(asset) {
	return new Promise((resolve, reject) => {
		const req = https.request({
			auth,
			method: 'HEAD',
			hostname: asset.hostname,
			path: asset.path,
			headers: {
				Accept: 'application/octet-stream',
				'User-Agent': userAgent
			}
		}, res => resolve(res.headers.location));

		req.on('error', e => reject(e));
		req.end();
	});
}

function getFileFromPlatform(platform) {
	if (platform === 'darwin') {
		return process.env.DARWIN_DIRECT_FILE || process.env.DARWIN_ZIP_FILE;
	} else if (platform === 'win32') {
		return process.env.WIN32_DIRECT_FILE;
	} else if (platform === 'linux') {
		return process.env.LINUX_DIRECT_FILE;
	}
}

router.param('platform', function *handlePlatform(platform, next) {
	if (~['darwin', 'win32', 'linux'].indexOf(platform)) {
		this.platform = platform;
		yield next;
	} else {
		this.status = 400;
	}
});

router.param('arch', function *handleArch(arch, next) {
	if (~['ia32', 'x64'].indexOf(arch)) {
		this.arch = arch;
		yield next;
	} else {
		this.status = 400;
	}
});

router.param('version', function *handleCurrentVersion(version, next) {
	// Must be a valid semver version
	if (semver.valid(version)) {
		this.version = version;
		yield next;
	} else {
		this.status = 400;
	}
});

router.param('currentVersion', function *handleCurrentVersion(version, next) {
	// Must be a valid semver version
	if (!semver.valid(version)) {
		this.status = 400;
	} else if (semver.lte(releases[0].tag_name, version)) {
		this.status = 204;
	} else {
		this.version = version;
		yield next;
	}
});

router.param('filename', function *handleFilename(filename, next) {
	if (filename === 'RELEASES') {
		yield next;
	} else if (/-(delta|full)\.nupkg$/.test(filename)) {
		yield next;
	} else {
		this.status = 400;
	}
});

// Handle Darwin Auto-Updater
router.get('/update/darwin/x64/:currentVersion', function *handleDarwin() {
	const filename = process.env.DARWIN_ZIP_FILE;

	this.body = {
		url: `${this.origin}/download/${releases[0].tag_name}/${filename}`,
		link: auth ? undefined : releases[0].html_url,
		name: releases[0].name,
		notes: releases[0].body,
		pub_date: releases[0].published_at
	};
});

// Handle Windows Auto-Updater
// :filename will usually be RELEASES, *-delta.nupkg, or *-full.nupkg
router.get('/update/win32/:arch/:currentVersion/:filename', function *handleWindows() {
	let filename = this.params.filename;
	let release;

	if (this.params.filename === 'RELEASES') {
		// RELEASES should only be fetched from the latest version
		release = releases[0].tag_name;

		if (process.env.WIN32_RELEASES_FILE) {
			filename = processFilename(process.env.WIN32_RELEASES_FILE, this.params);
		}
	} else {
		if (process.env.WIN32_NUPKG_FILE) {
			filename = processFilename(process.env.WIN32_NUPKG_FILE, {
				filename,
				arch: this.arch,
				platform: this.platform
			});
		}

		// *-delta.nupkg and *-full.nupkg can come from previous versions
		release = getReleaseVersionFromAsset(filename);

		if (!release) {
			this.status = 204;

			return;
		}
	}

	this.redirect(router.url('download', {
		version: release,
		file: filename
	}));
});

router.get('/download/latest/:file', function *downloadLatestFile() {
	this.redirect(router.url('download', {
		version: releases[0].tag_name,
		file: this.params.filename
	}));
});

router.get('/download/latest/:platform/:arch', function *downloadLatestFile() {
	this.redirect(router.url('download-file', {
		version: releases[0].tag_name,
		platform: this.platform,
		arch: this.arch
	}));
});

router.get('download-file', '/download/:version/:platform/:arch', function *downloadVersionedFile() {
	let file = getFileFromPlatform(this.platform);

	if (!file) {
		this.status = 404;

		return;
	}

	file = processFilename(file, this.params);

	this.redirect(router.url('download', {
		file,
		version: this.version
	}));
});

router.get('download', '/download/:version/:file', function *downloadVersionedFile() {
	const asset = getAssetFromReleaseVersion(this.version, this.params.file);

	if (asset) {
		const assetUrl = yield getAssetUrl(asset);
		this.redirect(assetUrl);
	} else {
		this.status = 404;
	}
});

router.get('/api/versions', function *listVersions() {
	const versions = [];
	releases.forEach(r => versions.push(r.tag_name));
	this.body = { versions };
});

router.get('/api/version/latest', function *getLatestVersionInfo() {
	this.redirect(router.url('version', releases[0].tag_name));
});

router.get('version', '/api/version/:version', function *getVersionInfo() {
	let release;

	for (let i = 0, l = releases.length; i < l; i++) {
		if (semver.eq(releases[i].tag_name, this.version)) {
			release = releases[i];
			break;
		}
	}

	if (!release) {
		this.status = 404;

		return;
	}

	this.body = {
		version: this.version,
		link: auth ? undefined : release.html_url,
		name: release.name,
		notes: release.body,
		pub_date: release.published_at,
		files: release.assets.map(asset => {
			return {
				name: asset.name,
				url: `${this.origin}/download/${this.version}/${asset.name}`,
				label: asset.label,
				content_type: asset.content_type,
				size: asset.size,
				download_count: asset.download_count
			};
		})
	};
});

router.get('/api/resolve', function *resolveDownloadInfo() {
	const ua	= this.headers['user-agent'].toLowerCase();
	const base	= `${this.origin}/download/latest`;
	const info	= {
		platform: this.query.platform,
		arch: this.query.arch
	};

	if ((!info.platform || !info.arch) && regexps.darwin.test(ua)) {
		info.platform	= 'darwin';
		info.arch		= 'x64';
	} else {
		if (!info.platform && regexps.win32.test(ua)) {
			info.platform = 'win32';
		} else if (!info.platform && regexps.linux.test(ua)) {
			info.platform = 'linux';
		}

		if (!info.arch && regexps.x64.test(ua)) {
			info.arch = 'x64';
		} else if (!info.arch && regexps.ia32.test(ua)) {
			info.arch = 'ia32';
		} else if (!info.arch) {
			info.suggestedArch = 'ia32';
		}
	}

	if (info.platform && info.arch) {
		info.url = `${base}/${info.platform}/${info.arch}`;
	} else if (info.platform && info.suggestedArch) {
		info.suggestedUrl = `${base}/${info.platform}/${info.suggestedArch}`;
	}

	this.body = info;
});

// Update to the latest version
let timeout;
router.post('/webhook', function *handleWebhook() {
	this.status = 200;

	if (this.headers['x-github-event'] !== 'release') {
		return;
	}

	if (process.env.WEBHOOK_FETCH_TIMEOUT <= 0) {
		yield getAllReleases();
	} else {
		if (timeout) {
			clearTimeout(timeout);
		}

		// The release may not have assets if it's published before they are
		// uploaded, so let's wait WEBHOOK_FETCH_TIMEOUT seconds.
		const seconds	= process.env.WEBHOOK_FETCH_TIMEOUT * 1000;
		timeout			= setTimeout(getAllReleases, seconds);
	}
});

app.use(body());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(process.env.PORT || 8000);
getAllReleases();
