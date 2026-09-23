import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './paths.js';

const FILE = path.join(DATA_DIR, 'posts.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

let posts = load();

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(posts, null, 2));
  fs.renameSync(tmp, FILE);
}

export function listPosts() {
  return [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPost(id) {
  return posts.find((p) => p.id === id);
}

export function createPost(fields) {
  const now = new Date().toISOString();
  const post = {
    id: crypto.randomUUID(),
    status: 'draft', // draft → researched → written → published
    interest: '',
    memo: '',
    media: [],
    sources: [],
    topics: [],
    topic: null,
    article: null,
    publishedUrl: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  posts.push(post);
  save();
  return post;
}

export function updatePost(id, patch) {
  const post = getPost(id);
  if (!post) throw new Error('글을 찾을 수 없어요.');
  Object.assign(post, patch, { updatedAt: new Date().toISOString() });
  save();
  return post;
}

export function deletePost(id) {
  const post = getPost(id);
  posts = posts.filter((p) => p.id !== id);
  save();
  return post;
}
