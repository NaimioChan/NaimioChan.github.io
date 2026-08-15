// 下载 6 张封面到 public/covers/
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const covers = [
  ['cover-announce.jpg', 'https://cdn.dizzylab.net/media/cover/' + encodeURIComponent('封面_终稿_印刷版.jpg')],
  ['cover-01.jpg', 'https://p2.music.126.net/yG332zaajq-2EORLH6gcAw==/109951173140771453.jpg'],
  ['cover-02.jpg', 'https://p2.music.126.net/XOgiKm08EWTBfXZjy62-_Q==/109951172685416375.jpg'],
  ['cover-03.jpg', 'https://p2.music.126.net/b3PqmjSoIAx2xTrVIHWQBA==/109951172576628241.jpg'],
  ['cover-04.jpg', 'https://p1.music.126.net/qdSIAx98Kqwu5NwUo6JSng==/109951170608640137.jpg'],
  ['cover-05.jpg', 'https://p2.music.126.net/oBSeVrbgHH-jboCwdavMpw==/109951170218492888.jpg'],
];

const dir = resolve('public/covers');
mkdirSync(dir, { recursive: true });

for (const [name, url] of covers) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(resolve(dir, name), buf);
    console.log(`OK ${name} (${(buf.length / 1024).toFixed(0)} KB) <- ${url.slice(0, 70)}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
  }
}
