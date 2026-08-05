import { useEffect, useLayoutEffect, useState } from 'react';
import { GithubLogo } from '@phosphor-icons/react';
import { StickerEditor } from './components/StickerEditor';

export default function App() {
  const [showLoading, setShowLoading] = useState(true);
  const [loadingActive, setLoadingActive] = useState(true);

  useLayoutEffect(() => {
    if (!showLoading) return;

    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    window.scrollTo(0, 0);
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [showLoading]);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const closeTimer = window.setTimeout(() => setLoadingActive(false), reduceMotion ? 80 : 1400);
    const removeTimer = window.setTimeout(() => setShowLoading(false), reduceMotion ? 120 : 2150);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  return (
    <div className="app-root">
      {showLoading && (
        <div
          className={`loading-layer${loadingActive ? '' : ' is-leaving'}`}
          aria-live="polite"
          aria-label="正在打开安心院小姐的酸橙味照片生成器"
        >
          <div className="loading-content" aria-hidden="true">
            <img className="loading-title-logo" src="/logo.svg" alt="" />
          </div>
          <span className="visually-hidden">正在加载</span>
        </div>
      )}

      <div className={`page-shell${loadingActive ? ' is-loading' : ' is-ready'}`}>
        <header className="app-header">
          <div className="brand-lockup">
            <img
              className="brand-title-logo"
              src="/logo.svg"
              alt="安心院小姐的酸橙味照片生成器"
            />
          </div>
        </header>

        <main>
          <StickerEditor />
        </main>

        <footer className="app-footer">
          <img className="footer-mascot" src="/orange-angelina.svg" alt="" />
          <div className="footer-content">
            <div className="footer-disclaimer">
              <p>
                本网站是由《明日方舟》游戏爱好者制作。网站所涉及的公司名称、商标、产品等均为其各自所有者的资产，仅供识别。
              </p>
              <p>网站内使用的图片版权属于上海鹰角网络科技有限公司及其关联公司。</p>
              <p>
                部分贴纸来源于
                <a
                  href="https://space.bilibili.com/7986011"
                  target="_blank"
                  rel="noreferrer"
                >
                  @安澜_QAQ
                </a>
              </p>
            </div>
            <div className="footer-meta">
              <div className="footer-links">
                <a
                  className="footer-project-link"
                  href="https://github.com/colasama/Orange-Generator"
                  target="_blank"
                  rel="noreferrer"
                >
                  <GithubLogo size="1em" weight="bold" aria-hidden="true" />
                  <span>colasama/Orange-Generator</span>
                </a>
                <a
                  href="https://github.com/guokaigdg/animal-island-ui"
                  target="_blank"
                  rel="noreferrer"
                >
                  Animal Island UI · CC BY-NC 4.0
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
