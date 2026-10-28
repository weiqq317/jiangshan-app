#!/usr/bin/env node
/**
 * 拉取上游 DeanChensj/jiangshan-map 快照到 upstream/ 目录。
 *
 * 说明：本机 github.com 的 git 协议不可达（HTTP2 framing 错误），
 * 因此改用 codeload tarball 方式获取，并在 upstream/.upstream-version.json
 * 中固化本次快照的 commit SHA，便于日后比对上游更新。
 *
 * 溯源钉定：设置环境变量 UPSTREAM_SHA=<完整 commit SHA> 可拉取指定提交而非 main 分支，
 * 用于可复现构建（CI 由 workflow_dispatch 的 upstream_sha 输入透传）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const UPSTREAM = path.join(ROOT, 'upstream');
const REPO = 'DeanChensj/jiangshan-map';

/** 钉定的上游 commit SHA；空则跟随 main 分支 */
const PINNED_SHA = (process.env.UPSTREAM_SHA || '').trim();
const REF = PINNED_SHA || 'main';
const ARCHIVE_URL = PINNED_SHA
  ? `https://codeload.github.com/${REPO}/tar.gz/${PINNED_SHA}`
  : `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}`;
const COMMIT_API = `https://api.github.com/repos/${REPO}/commits/${REF}`;

const HEADERS = { 'User-Agent': 'jiangshan-app-fetch' };

/** 流式下载远端文件到本地（自动跟随重定向） */
async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: HEADERS });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

/** 读取上游 main 的最新 commit 信息；失败时返回 null（不阻塞快照流程） */
async function fetchCommitInfo() {
  try {
    const res = await fetch(COMMIT_API, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    return { sha: data.sha, date: data.commit?.committer?.date ?? null };
  } catch {
    return null;
  }
}

async function main() {
  const archive = path.join(os.tmpdir(), `jiangshan-map-${REF}.tar.gz`);

  console.log(`[fetch_upstream] 下载 ${ARCHIVE_URL}`);
  await download(ARCHIVE_URL, archive);

  fs.rmSync(UPSTREAM, { recursive: true, force: true });
  fs.mkdirSync(UPSTREAM, { recursive: true });

  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', UPSTREAM], {
    stdio: 'inherit',
  });
  fs.rmSync(archive, { force: true });

  const commit = PINNED_SHA ? { sha: PINNED_SHA, date: null } : await fetchCommitInfo();
  const version = {
    repo: `https://github.com/${REPO}`,
    ref: REF,
    pinned: Boolean(PINNED_SHA),
    sha: commit?.sha ?? null,
    commitDate: commit?.date ?? null,
    fetchedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(UPSTREAM, '.upstream-version.json'),
    `${JSON.stringify(version, null, 2)}\n`,
    'utf-8'
  );

  if (!fs.existsSync(path.join(UPSTREAM, 'index.html'))) {
    throw new Error('上游快照不完整：未找到 upstream/index.html');
  }

  console.log(
    `[fetch_upstream] 上游快照已就绪：${UPSTREAM}\n` +
      `   ref=${REF}${PINNED_SHA ? '（已钉定）' : ''} sha=${version.sha ?? '未知'} date=${version.commitDate ?? '未知'}`
  );
}

main().catch((err) => {
  console.error(`[fetch_upstream] 失败：${err.message}`);
  console.error('请检查 codeload.github.com 的可达性后重试。');
  process.exit(1);
});
