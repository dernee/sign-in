-- ============================================================================
-- 班级扫码签到系统（Supabase 版）· 数据库初始化脚本
-- ----------------------------------------------------------------------------
-- 执行位置：
--   Supabase 控制台 → 左侧栏「SQL Editor」→「New query」→
--   粘贴本文件全部内容 → 点击「Run」
--
-- 本脚本可重复执行（全部使用幂等写法），报"已存在"也不会破坏数据。
-- 执行成功后，刷新 Table Editor 即可看到 signin_records 表。
-- ============================================================================

-- ① 建表：signin_records（签到记录表）
create table if not exists public.signin_records (
  id          uuid        primary key default gen_random_uuid(),
  student_id  text        not null,
  name        text,
  created_at  timestamptz not null default now()
);
-- 字段说明：
--   id          记录唯一标识，系统自动生成，不参与展示
--   student_id  学号（业务唯一键；"一人只能签一次"由 ② 的唯一索引保证）
--   name        姓名（需求只强制学号必填，故允许为空；后台空姓名显示为 —）
--   created_at  签到时间。数据库按 UTC 存储，页面按浏览器本地时区显示

-- ② 唯一索引：同一个学号只能签到一次（数据库层兜底）
--    即使两台手机同时提交同一学号，也只会有一次插入成功，
--    另一次会收到 23505 唯一冲突错误，前端按"重复签到"处理。
create unique index if not exists uniq_signin_records_student_id
  on public.signin_records (student_id);

-- ③ 开启 RLS（行级安全）。不开 RLS 的表会拒绝所有匿名 API 访问。
alter table public.signin_records enable row level security;

-- ④ 显式授权给匿名角色 anon
--    重要：2026-05-30 之后新建的项目、2026-10-30 之后所有新建表，
--    Supabase 不再自动把 public 新表授权给 API 角色，必须显式 GRANT，
--    否则即使配好 RLS 策略，请求也会报 42501 权限错误。
grant usage on schema public to anon;
grant select, insert on public.signin_records to anon;

-- ⑤ 创建 RLS 策略（先删同名旧策略，保证脚本可重复执行）
--    插入放行：任何匿名访问者都可以提交签到
drop policy if exists "anon_can_insert_signin" on public.signin_records;
create policy "anon_can_insert_signin"
  on public.signin_records
  for insert to anon
  with check (true);

--    读取放行：任何匿名访问者都可以查看签到列表（后台页展示、签到页查重都需要）
drop policy if exists "anon_can_select_signin" on public.signin_records;
create policy "anon_can_select_signin"
  on public.signin_records
  for select to anon
  using (true);

-- ⑥ 没有授权 update / delete：匿名访问只能"新增记录、查看列表"，
--    不能篡改或删除历史签到数据。
--
-- 【安全提示】insert / select 对全网放开是"课堂签到"的简化取舍：
--   - 知道网页网址的人可以提交任意学号的签到（无法完全防代签）；
--   - 可以查看全部签到名单。
--   如需加固，见 README「安全说明与可选加固」一节。
