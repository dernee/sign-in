# 班级扫码签到系统（Supabase 版）

手机扫码 → 填姓名学号 → 签到写入云端数据库 → 教师后台实时查看并可一键导出 CSV（Excel 可直接打开）。

- 技术栈：原生 HTML + JavaScript + Supabase JS v2（CDN 引入，无框架、无构建步骤）
- 部署目标：GitHub Pages（纯静态托管，免费）
- 本目录 `supabase-version/` 内的文件整体上传一个 GitHub 仓库即可部署
- 旧版（`Desktop\班级二维码签到系统\` 根目录下的单机演示版）数据只存浏览器内存、
  手机扫码无法回传，本版用 Supabase 数据库解决跨设备共享问题，两版相互独立

---

## 一、目录结构

```
supabase-version/
├── index.html          入口导航页（GitHub Pages 根路径需要 index.html）
├── sign.html           学生签到页（手机扫码打开的就是它）
├── admin.html          教师后台页（统计 + 表格 + 导出）
├── css/style.css       三页共享样式
├── js/config.js        ★ 唯一需要修改的文件：填 Supabase 地址与密钥
├── js/sign.js          签到页逻辑（校验、查重、写入）
├── js/admin.js         后台页逻辑（加载、渲染、自动刷新、CSV 导出）
├── supabase-setup.sql  数据库初始化脚本（建表 + 唯一索引 + RLS 策略 + 授权）
└── README.md           本文档
```

## 二、数据表设计

表名：`public.signin_records`，由 `supabase-setup.sql` 一键创建。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | 主键，默认 `gen_random_uuid()` | 系统自动生成的记录标识，页面不展示 |
| `student_id` | text | NOT NULL，**唯一索引** | 学号，业务唯一键；"同一个学号只能签到一次"靠它保证 |
| `name` | text | 可空 | 姓名。需求只强制学号必填；本实现为数据完整性同时校验了姓名（改法见第七节第 1 条） |
| `created_at` | timestamptz | NOT NULL，默认 `now()` | 签到时间。数据库按 UTC 存储，页面按浏览器本地时区显示 |

防重复签到是双保险：

1. 前端提交前先查询该学号是否已存在（给同学友好提示）；
2. 数据库 `student_id` 唯一索引兜底——两台设备并发提交同一学号时，
   后到的插入会收到 23505 唯一冲突错误，同样按"重复签到"处理，最终只入库一条。

## 三、Supabase 配置步骤（约 10 分钟）

1. **注册 / 登录**：打开 <https://supabase.com>，用 GitHub 或邮箱注册（免费额度足够班级使用）。
2. **新建项目**：控制台点「New project」，随便起个名字（如 `class-signin`），
   设置数据库密码（自己保存好），区域就近选择（如 Singapore / Tokyo），等待约 2 分钟初始化。
3. **执行建表脚本**：左侧栏打开「SQL Editor」→「New query」→
   把本目录 `supabase-setup.sql` 的**全部内容**粘贴进去 → 点「Run」。
   提示 Success 后，左侧「Table Editor」里应能看到 `signin_records` 表。
   脚本已包含：建表、学号唯一索引、开启 RLS、创建允许匿名读写的策略、显式 GRANT 授权。
4. **获取项目地址与密钥**：
   - 项目地址（Project URL）：形如 `https://abcdefghijk.supabase.co`。
     可从项目页顶部「Connect」弹窗复制，或在 Project Settings → Data API 页面查看。
   - 密钥：左下角 Project Settings → **API Keys**。二选一即可：
     - 新式 Publishable key（`sb_publishable_` 开头，官方当前推荐）；
     - 旧式 anon key（`eyJ` 开头，在 Legacy API Keys 标签页，2026 年底前仍可用）。
   - ⚠️ 绝对不要使用 secret / service_role 密钥：那是服务端机密，
     浏览器里用它会被拒绝（401），泄露等于数据库裸奔。
5. **填入配置**：打开 `js/config.js`，把第 16、19 行两个占位符替换为上面的真实值，保存。
   文件里有逐行中文注释，其余代码不需要动。

### RLS（行级安全）说明

RLS 是 Supabase 的权限防线：开启后，API 请求只能按策略（policy）访问数据。
`supabase-setup.sql` 已自动完成全部 RLS 配置，等效于手动做以下三件事：

| 手动操作路径 | 作用 |
| --- | --- |
| Table Editor → 打开 `signin_records` → 开启 RLS 开关 | 没开 RLS 的表拒绝所有匿名 API 访问 |
| Authentication → Policies → New policy → 允许 anon SELECT | 后台页能读列表、签到页能查重 |
| Authentication → Policies → New policy → 允许 anon INSERT | 学生能写入签到记录 |

> 若控制台界面与描述略有出入，直接用 SQL Editor 执行脚本最稳妥，效果完全一致。
>
> 另注意：2026-05-30 之后新建的项目（以及 2026-10-30 之后所有项目里的新表），
> Supabase 不再自动为 API 角色授权，必须像脚本第 ④ 节那样显式 `GRANT`，
> 否则即使策略齐全也会报 42501 权限错误。

## 四、部署到 GitHub Pages

> 前提：第三步已完成，`js/config.js` 里已填好真实地址与密钥。

**方式 A：网页上传（零命令行，推荐）**

1. 登录 <https://github.com> → 右上角「+」→「New repository」。
2. 仓库名如 `class-signin`，可见性选 **Public**（免费账号的 Pages 需要），点创建。
3. 仓库页点「uploading an existing file」，把 `supabase-version/` 目录下的
   **全部文件**（含 css、js 子文件夹，注意不是整个文件夹本身）拖进去 →「Commit changes」。
   上传后仓库根目录应直接能看到 `index.html`、`sign.html`、`admin.html`。
4. 仓库 →「Settings」→ 左侧「Pages」→「Build and deployment」→
   Source 选「Deploy from a branch」，Branch 选 `main` / `(root)` →「Save」。
5. 等待 1~3 分钟，刷新 Pages 页面，顶部出现网址：
   `https://你的用户名.github.io/class-signin/`

**方式 B：Git 命令行**

```bash
cd supabase-version
git init
git add .
git commit -m "init: class signin (supabase)"
git branch -M main
git remote add origin https://github.com/你的用户名/class-signin.git
git push -u origin main
# 然后同样到 Settings → Pages 开启，步骤同方式 A 第 4 步
```

部署后的两个关键网址：

| 页面 | 网址 | 用途 |
| --- | --- | --- |
| 学生签到 | `https://你的用户名.github.io/class-signin/sign.html` | 做成二维码给学生扫 |
| 教师后台 | `https://你的用户名.github.io/class-signin/admin.html` | 自己收藏，看数据、导 CSV |

## 五、生成签到二维码

1. 打开任意二维码生成工具，例如草料二维码 <https://cli.im/>（免费，支持文字/网址）。
2. 内容类型选「网址」，粘贴上面 **sign.html 的完整网址**，生成并下载图片。
3. 打印贴在教室门口，或投屏让学生扫；微信「扫一扫」、手机相机、各大 App 扫码均可识别。
4. 这个二维码是**长效固定**的——网址不变就永远有效，做一次可反复使用。

## 六、测试方法（部署后建议逐项过一遍）

| # | 测试项 | 操作 | 预期结果 |
| --- | --- | --- | --- |
| 1 | 配置自检 | 未填密钥时打开 sign.html | 页面顶部出现"尚未完成配置"红色提示，表单隐藏 |
| 2 | 空学号校验 | 姓名随便填，学号清空后提交 | 学号框红边 + 提示"学号不能为空"，不发请求 |
| 3 | 正常签到 | 填写姓名学号提交 | 显示绿色"签到完成"卡片（含学号与签到时间），表单锁定 |
| 4 | 数据入库 | 打开 admin.html | 总人数 +1，表格出现该记录，签到时间与本机时间一致 |
| 5 | 防重复 | 同一学号再次提交（可换浏览器/设备） | 提示"请勿重复签到"，后台仍只有一条记录 |
| 6 | 并发防重（可选） | 两台设备同时提交同一学号 | 只有一台成功（唯一索引兜底），另一台提示重复 |
| 7 | 排序 | 连续几人签到 | 最新签到始终在最上面一行 |
| 8 | 导出 CSV | 点「导出 CSV」，双击用 Excel 打开 | 中文不乱码，四列对齐（序号/姓名/学号/签到时间） |
| 9 | 自动刷新 | 后台开着，让学生签到 | 10 秒内数字与表格自动更新 |
| 10 | 跨网络 | 手机关 WiFi 用流量扫码签到 | 正常完成（验证公网链路，不只局域网） |
| 11 | 断网容错 | 手机开飞行模式提交 | 显示"网络连接失败"提示，不会假装成功 |
| 12 | 控制台 | F12 → Console | 无红色报错 |

## 七、常见报错排查

| 现象（控制台关键词） | 原因 | 解决办法 |
| --- | --- | --- |
| 页面顶部"尚未完成配置" | `js/config.js` 占位符没替换 | 填入真实地址与密钥，刷新 |
| `supabase is not defined` | 两个 CDN（jsDelivr/unpkg）都连不上，多为校园网拦截或断网 | 换网络刷新；仍失败可下载 `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js` 存为 `js/supabase.js`，把页面里的两个 `<script src="https://...">` 换成本地路径 |
| `Failed to fetch` / 网络连接失败 | 网络不通；或 `SUPABASE_URL` 拼写错误导致请求打到不存在的主机 | 核对地址以 `https://` 开头、以 `.supabase.co` 结尾、无空格和中文引号；浏览器 F12 → Network 看请求状态 |
| 关于"跨域 CORS"的报错 | Supabase Data API 默认允许所有来源（origin）跨域访问，正常不会出现 CORS 错误；出现时几乎都是 URL 填错（少了协议头、混入全角引号等），请求根本没到 Supabase | 按上一条核对 `config.js`；确认引号是英文直引号 `'` |
| `42501` / "new row violates row-level security policy" / permission denied | RLS 开了但策略或授权缺失（例如只手动建了表、没跑完整脚本） | 在 SQL Editor 重新完整执行 `supabase-setup.sql`（脚本可重复执行） |
| `42P01` / relation "public.signin_records" does not exist | 还没建表 | 执行 `supabase-setup.sql` |
| `401` / "Invalid API key" | 密钥复制不完整；或误用了 secret / service_role 密钥（浏览器使用会被拒绝） | 改用 anon（旧式）或 publishable（新式）密钥，完整复制 |
| **重复签到失效**（同一学号还能签进去） | `student_id` 唯一索引没有建成（常见于手动建表漏掉） | SQL Editor 执行：`create unique index if not exists uniq_signin_records_student_id on public.signin_records (student_id);` 若报"存在重复值"，先在 Table Editor 手动清理重复行 |
| 学号明明一样却提示重复/查重不准 | 复制粘贴混入不可见字符或前后空格 | 代码已做归一化（去空白、零宽字符、数字尾巴 `.0`）；极端情况删除该条记录重签 |
| CSV 用 Excel 打开乱码 | Excel 需要 UTF-8 BOM 才认中文 | 本项目导出已内置 BOM 与 CRLF；若用很旧的 Office，请改用 WPS 或新版 Excel |
| 签到时间"差 8 小时" | 数据库按 UTC 存储是正常设计；页面显示时已转本地时区 | 若在 Table Editor 里直接看原始值觉得"慢 8 小时"，那是 UTC，页面显示是对的 |
| GitHub Pages 打开 404 | 文件没传到仓库根目录；或 Pages 分支/目录选错；仓库名大小写不一致 | 确认根目录有 `index.html`；Pages 选 `main` + `/ (root)`；网址大小写与仓库名完全一致 |
| 改了 config.js 没生效 | 浏览器缓存 | Ctrl+F5 强制刷新；手机端清除缓存或无痕窗口打开 |

## 八、安全说明与可选加固

**当前策略的边界（请知情使用）：**

- anon/publishable 密钥出现在网页源码里是 Supabase 的正常设计，真正的防线是 RLS；
  但本方案为了"全班免登录签到"，把 SELECT / INSERT 对全网放开了，因此：
  1. 知道网址的人可以替别人提交签到（**不能完全防代签**，考勤凭证效力有限）；
  2. 知道后台网址的人可以查看全部名单（后台链接请只自己保存）；
  3. 理论上有人可以恶意灌入假数据。
- 未授权 UPDATE / DELETE：匿名访问者改不了、删不了历史记录。

**可选加固方向（按需实施）：**

1. 只允许名单内学号签到：另建 `students` 表导入班级名单，
   给 `signin_records.student_id` 加外键指向名单表，配一条
   `with check (exists (...) )` 的插入策略——名单外学号将被数据库直接拒绝。
2. 后台加锁：给 admin.html 加 Supabase Auth 邮箱密码登录，
   读取策略改为 `to authenticated`，签到策略保持 anon。
3. 每次课程前清空旧数据：SQL Editor 执行 `truncate table public.signin_records;`（不可恢复，谨慎）。

**两个明确标注的默认设计（如需改动）：**

1. 姓名必填：需求文档只要求"学号不能为空"，本实现额外校验了姓名
   （理由：后台表格以姓名为主列，留空会影响名单完整性）。
   若允许姓名留空：删除 `js/sign.js` 中本地校验段落的 `if (!name) {...}` 一行即可，
   数据库字段本身允许为空。
2. 只保留签到、不校验时间窗口：与旧版不同，本版二维码长效、不限 5 分钟。
   若需要"限时签到"，可在插入策略上追加时间条件（如 `with check (created_at 相关约束)`），
   或由教师上课时用 `truncate` 清场控制。

## 九、参考与许可

实现过程中参考的公开文档（本项目代码均为原创编写）：

> Supabase. "JavaScript API Reference | Supabase Docs." *Supabase Documentation*, supabase.com/docs/reference/javascript. Accessed 2 Nov. 2026.

> Supabase. "Migrating to publishable and secret API Keys." *Supabase Documentation*, supabase.com/docs/guides/getting-started/migrating-to-new-api-keys. Accessed 2 Nov. 2026.

> Supabase. "Understanding API Keys." *Supabase Documentation*, supabase.com/docs/guides/api/api-keys. Accessed 2 Nov. 2026.

> GitHub. "Creating a GitHub Pages Site." *GitHub Docs*, docs.github.com/en/pages/quickstart. Accessed 2 Nov. 2026.

> MDN Web Docs. "Blob." *MDN*, developer.mozilla.org/en-US/docs/Web/API/Blob. Accessed 2 Nov. 2026.（CSV 下载与 BOM 处理参考）
