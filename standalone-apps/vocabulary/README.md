# LikeGirl SmallPhone Source App

This directory is a SmallPhone source-app adapter for the upstream LikeGirl v5.2.0 application:

https://gitee.com/kiCode111/like-girl-v5.2.0

It intentionally does not vendor or recreate the upstream PHP/MySQL app. The SmallPhone wrapper only records source metadata and provides local scripts for linking an external checkout and serving it during development.

The directory name is `vocabulary` because that is the current Worker-2 owned scope. A clearer future path would be `standalone-apps/like-girl/`.

The upstream project is published as AGPL-3.0. Preserve upstream license and copyright notices when deploying or modifying it.

## Requirements

- Node.js >= 20
- pnpm via Corepack
- PHP CLI with the built-in server available as `php`
- MySQL-compatible database configured according to the upstream LikeGirl documentation

## Clone

Clone the upstream source into this adapter directory:

```bash
cd /root/projects/smallphone/smallphone-active/standalone-apps/vocabulary
git clone https://gitee.com/kiCode111/like-girl-v5.2.0.git source
```

Or clone it elsewhere:

```bash
git clone https://gitee.com/kiCode111/like-girl-v5.2.0.git /path/to/like-girl-v5.2.0
cd /root/projects/smallphone/smallphone-active/standalone-apps/vocabulary
pnpm link-source /path/to/like-girl-v5.2.0
```

The adapter also accepts an environment variable instead of a `source` symlink:

```bash
LIKE_GIRL_SOURCE_DIR=/path/to/like-girl-v5.2.0 pnpm start
```

## Configure

Follow the upstream LikeGirl setup for database import and PHP configuration. The upstream project stores database settings in `admin/Config_DB.php` and ships SQL files in the source repository.

Do not commit database credentials or generated upstream files into this adapter.

## Start

```bash
cd /root/projects/smallphone/smallphone-active/standalone-apps/vocabulary
corepack enable
PORT=23002 pnpm start
```

`PORT` defaults to `23002`. `HOST` defaults to `127.0.0.1`. `PHP_BIN` can point to a non-default PHP binary.

The launcher serves the linked upstream source with:

```bash
php -S 127.0.0.1:23002 -t source
```

## SmallPhone Manifest

`smallphone.app.json` describes this as a source app. SmallPhone tooling can read the manifest, clone or link the external source, then run `pnpm start` from this directory.

## Local Checks

```bash
pnpm check
pnpm test
```

These checks validate only the adapter metadata and scripts. They do not clone the upstream repo and do not verify the upstream PHP application.
