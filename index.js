'use strict';

const app		= require('koa')();
const body		= require('koa-buddy');
const router	= require('koa-router')();
const semver	= require('semver');
const https		= require('https');
const url		= require('url');
const version	= require('./package.json').version;
const userAgent = `Squirrel-Server (${version})`;
const platforms	= ['darwin', 'win32'];

const archSynonyms = {
	x86: 'ia32',
	x86_64: 'x64',
	amd64: 'x64',
	ia32: 'x86',
	x64: 'amd64'
};

let latest, auth;

if (process.env.GITHUB_TOKEN) {
	auth = process.env.GITHUB_TOKEN + ':';
}

function getLatestRelease() {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'api.github.com',
			path: `/repos/${process.env.GITHUB_REPO}/releases/latest`,
			auth: auth,
			headers: {
				'User-Agent': userAgent
			}
		};

		const req = https.request(options, res => {
			let data = '';

			res.setEncoding('utf8');
			res.on('data', str => data += str);
			res.on('end', () => resolve(JSON.parse(data)));
		});

		req.on('error', e => reject(e));
		req.end();
	}).then(data => latest = data);
}

function getFilename(query, value) {
	let file = process.env.DARWIN_FILE;

	for (let key in query) {
		file = file.replace(`{{${key}}}`, value(query[key]));
	}

	return file;
}

function getAsset(filename) {
	let i = 0,
		l = latest.assets.length;

	for (; i < l; i++) {
		if (latest.assets[i].name === filename) {
			return url.parse(latest.assets[i].url);
		}
	}
}

function getAssetByArch(filename, arch) {
	if (!arch) {
		return getAsset(filename);
	}

	let asset = getAsset(`${arch}-${filename}`);

	if (!asset) {
		arch	= archSynonyms[arch];
		asset	= getAsset(`${arch}-${filename}`);
	}

	return asset || getAsset(filename);
}

function getAssetUrl(asset) {
	return new Promise((resolve, reject) => {
		const options = {
			method: 'HEAD',
			hostname: asset.hostname,
			path: asset.path,
			auth: auth,
			headers: {
				Accept: 'application/octet-stream',
				'User-Agent': userAgent
			}
		};

		const req = https.request(options, res => resolve(res.headers.location));

		req.on('error', e => reject(e));
		req.end();
	});
}

// Darwin releases
router.get('/latest', function *getLatestRelease() {
	if (!latest || !this.query.version) {
		// wait for next request
		this.status = 204;
		return;
	} else if (semver.lte(latest.tag_name, this.query.version)) {
		this.status = 204;
		return;
	} else if (!~platforms.indexOf(this.query.platform)) {
		this.status = 204;
		return;
	}

	const filename	= getFilename(this.query);
	const asset		= getAsset(filename);

	if (!asset) {
		this.status = 204;
		return;
	}

	try {
		this.body = {
			url: yield getAssetUrl(asset),
			link: latest.html_url,
			name: latest.name,
			notes: latest.body,
			pub_date: latest.published_at
		};
	} catch (e) {
		this.status = 204;
		console.log(e);
	}
});

// Win32 releases
router.get('/latest/:filename', function *getReleasesFile() {
	let asset = getAssetByArch(this.params.filename, this.query.arch);

	if (!asset) {
		this.status = 404;
		return;
	}

	const assetUrl = yield getAssetUrl(asset);

	this.redirect(assetUrl);
});

// Update to the latest version
router.post('/webhook', () => {
	this.status = 200;

	if (this.headers['x-github-event'] !== 'ReleaseEvent') {
		return;
	}

	if (process.env.WEBHOOK_FETCH_TIMEOUT <= 0) {
		latest = this.request.body.release;
	} else {
		// The release may not have assets if it's published before they are
		// upload, so let's wait WEBHOOK_FETCH_TIMEOUT minutes.
		setTimeout(getLatestRelease, process.env.WEBHOOK_FETCH_TIMEOUT * 1000);
	}
});

app.use(body());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(process.env.PORT || 8000);
getLatestRelease();
