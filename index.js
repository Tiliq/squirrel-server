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

let latest, auth;

process.env.GITHUB_TOKEN = '247e70ee4356e6316a822e7cb009cd6901acc56b';
process.env.GITHUB_REPO = 'Tiliq/Desktop';
process.env.DARWIN_FILE = 'Tiliq-darwin-x64.zip';
process.env.WIN32_FILE = 'Tiliq-win32-{{arch}}.zip';
process.env.WEBHOOK_FETCH_TIMEOUT = "5";

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

function getFilename(query) {
	let file = process.env[query.platform.toUpperCase() + '_FILE'];

	for (let key in query) {
		file = file.replace(`{{${key}}}`, encodeURIComponent(query[key]));
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

function getAssetUrl(query) {
	const filename	= getFilename(query);
	const asset		= getAsset(filename);

	return new Promise((resolve, reject) => {
		if (!asset) {
			const error = new Error(`Asset "${filename}" not found`);
			return reject(error);
		}

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

	try {
		this.body = {
			url: yield getAssetUrl(this.query),
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

router.post('/webhook', () => {
	if (this.headers['x-github-event'] !== 'ReleaseEvent') {
		return;
	}

	// Latest have assets if published before they are uploaded
	// So, let's wait 5 minutes.
	setTimeout(getLatestRelease, process.env.WEBHOOK_FETCH_TIMEOUT * 1000);
});

app.use(body());
app.use(router.routes());
app.use(router.allowedMethods());

app.listen(process.env.PORT || 8000);
getLatestRelease();
