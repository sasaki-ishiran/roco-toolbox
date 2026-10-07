import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * 安卓壳的分享入口守卫（静态检查壳源码，不需要真机）。
 *
 * 真机上出过一次「分享面板里找不到洛克工具箱」：壳只注册了 SEND（系统分享面板），
 * 而微信 / QQ 的「用其他应用打开」发的是 VIEW 意图，文件挂在 intent.data 上。
 * 这类缺口网页侧的测试测不出来，把三个前提钉在这里，谁改坏了先在这里失败。
 */
const readShellFile = (relativePath: string): string => readFileSync(relativePath, 'utf8');

const manifest = readShellFile('android-shell/app/src/main/AndroidManifest.xml');
const activity = readShellFile(
  'android-shell/app/src/main/java/com/localdatatool/toolbox/MainActivity.java',
);

describe('安卓壳的分享入口', () => {
  test('注册了 VIEW 意图（微信 / QQ「用其他应用打开」里出现本应用的前提）', () => {
    const viewFilter = (manifest.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? []).find(
      (block) => block.includes('android.intent.action.VIEW'),
    );
    expect(viewFilter, '壳里应有 ACTION_VIEW 的 intent-filter').toBeDefined();
    // 类型写 */*：分享方按扩展名算出来的类型各式各样，写具体类型会漏
    expect(viewFilter).toContain('android:mimeType="*/*"');
    // scheme 限定在 content / file，避免把网页链接（http/https）之类的 VIEW 也揽进来
    expect(viewFilter).toContain('android:scheme="content"');
  });

  test('壳里处理 VIEW 意图：把打开的文件当分享内容交给网页', () => {
    expect(activity).toContain('Intent.ACTION_VIEW');
  });
});

describe('安卓壳的导出分享（1.1.4）', () => {
  test('注册了 RocoShare JS 桥（网页「导出全部数据」→ 壳调系统分享面板的前提）', () => {
    expect(activity).toContain('RocoShare');
    expect(activity).toContain('addJavascriptInterface');
    expect(activity).toContain('shareBackup');
  });

  test('分享走文件（EXTRA_STREAM + FileProvider），大备份不被文本截断', () => {
    expect(activity).toContain('Intent.ACTION_SEND');
    expect(activity).toContain('Intent.EXTRA_STREAM');
    expect(activity).toContain('com.localdatatool.toolbox.fileprovider');
    expect(manifest).toContain('androidx.core.content.FileProvider');
    expect(manifest).toContain('com.localdatatool.toolbox.fileprovider');
  });
});