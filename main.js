const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');
const { ensureDir } = require('fs-extra');

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <style>
    .mermaid text {
        font-size: 20px !important;
        font-family: "Microsoft Yahei" !important;
      }
    .mermaid .node text {
      font-size: 21px !important;
    }
    .mermaid {
      background: white;
    }
  </style>
</head>
<body>
  <div class="mermaid"></div>
</body>
</html>
`;

async function renderMermaid(inputPath, outputPath) {
  const mermaidJSPath = path.join(__dirname, 'lib/mermaid.min.js');
  const mermaidJS = await fs.readFile(mermaidJSPath, 'utf-8');
  const mermaidCode = await fs.readFile(inputPath, 'utf-8');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(HTML_TEMPLATE);
    
    // 🌟 先注入mermaid库再处理初始化
    await page.addScriptTag({ content: mermaidJS });
    
    await page.setViewport({ 
      width: 600,
      height: 1200,
      deviceScaleFactor: 2  
    });

    // 🌟 更可靠的初始化等待
    await page.waitForFunction(() => typeof mermaid !== 'undefined', { 
      timeout: 5000,
      polling: 100 
    });

    const { themeConfig, cleanCode } = processMermaidCode(mermaidCode);

    // 🌟 完整的配置初始化
    await page.evaluate((config, code) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        ...config,
        themeVariables: {
          fontSize: '24px',  // 默认值
          ...config.themeVariables
        }
      });
      
      const render = async () => {
        try {
          const { svg } = await mermaid.mermaidAPI.render('graph', code);
          document.querySelector('.mermaid').innerHTML = svg;
        } catch (err) {
          console.error('Render error:', err);
          throw err;
        }
      };
      
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            await render();
            resolve();
          } catch (err) {
            reject(err);
          }
        }, 100); // 确保DOM更新
      });
    }, themeConfig, cleanCode);

    await page.waitForSelector('.mermaid svg', { timeout: 10000 });

    // 创建输出目录
    const outputDir = path.dirname(outputPath);
    await ensureDir(outputDir);

    // 生成PNG
    const element = await page.$('.mermaid');
    await element.screenshot({
      path: outputPath,
      type: path.extname(outputPath).slice(1) || 'png',
      omitBackground: true
    });

    // 生成SVG
    const svgOutputPath = path.join(
      outputDir,
      `${path.basename(outputPath, path.extname(outputPath))}.svg`
    );
    const svgContent = await page.$eval('.mermaid svg', svg => svg.outerHTML);
    await fs.writeFile(svgOutputPath, svgContent);

  } finally {
    await browser.close();
  }
}

// 🌟 优化后的配置解析器
function processMermaidCode(code) {
  const initMatch = code.match(/%%{\s*init:\s*({[\s\S]*?})\s*}%%/);
  if (!initMatch) return { themeConfig: {}, cleanCode: code.trim() };

  try {
    let configStr = initMatch[1]
      .trim()
      // 阶段1：转换键名（支持特殊字符）
      .replace(/(['"])?([\w-]+)(['"])?:/g, '"$2":')  
      // 阶段2：清理尾部逗号
      .replace(/,(\s*})/g, '$1')
      // 阶段3：统一引号类型
      .replace(/'/g, '"');

    // 调试日志（开发时启用）
    console.log('Processing config:', configStr);

    const themeConfig = JSON.parse(configStr);
    const cleanCode = code.replace(/%%{[\s\S]*?}%%/g, '').trim();

    return { 
      themeConfig: {
        theme: 'base',
        ...themeConfig,
        themeVariables: {
          fontSize: '24px',
          ...themeConfig.themeVariables
        }
      },
      cleanCode
    };
  } catch (err) {
    console.error('配置解析失败，原始配置:', initMatch[1]); // 🌟 新增错误日志
    return { themeConfig: {}, cleanCode: code.trim() };
  }
}

(async () => {
  try {
    await renderMermaid(
      path.join(__dirname, 'input.txt'),
      path.join(__dirname, 'output/output.png')
    );
    console.log('图表生成成功！');
  } catch (err) {
    console.error('生成失败:', err);
  }
})();