import { CATALOG_SOURCE, CATALOG_SOURCE_URL, CATALOG_VERSION } from '../data/catalog';

export function SourceNotice() {
  return (
    <footer className="mt-4 text-xs leading-relaxed text-slate-400">
      <p>
        数据来源：{' '}
        <a
          className="inline-flex min-h-[44px] items-center text-slate-500 underline"
          href={CATALOG_SOURCE_URL}
          target="_blank"
          rel="noreferrer"
        >
          洛克王国：世界 Wiki
        </a>{' '}
        （{CATALOG_SOURCE || 'wiki.biligame.com/nrc'}，版本 {CATALOG_VERSION}）
      </p>
      <p>
        内容以{' '}
        <a
          className="inline-flex min-h-[44px] items-center text-slate-500 underline"
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY-SA 4.0
        </a>{' '}
        许可授权。
      </p>
    </footer>
  );
}
