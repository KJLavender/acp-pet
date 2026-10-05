# 會寫扣的電子雞：ACP Desk Pet 實作計畫

> 建立日期：2026-10-05
> 一句話：桌面養一隻寵物,牠其實是一個 ACP coding agent 的「擬人化儀表板」。
> agent 當下在幹嘛,寵物就演什麼——讀檔案=翻書、改扣=打字、跑指令=敲榔頭、要權限=跑來拉你衣角、測試過了=開心跳、出錯了=生病。

## 核心概念（跟別人的差異點）

查過現有專案(miku-on-desktop、codex-has-a-pet-too、OpenPet…),它們的寵物本體都是「聊天 agent」或「讀 log 猜狀態」。**我們的寵物不聊天、不猜——牠直接消費 ACP 的 `session/update` 事件流**,把 agent 真正發生的事件一對一映射成動作。這一點目前沒人做。

```
你丟一個任務 → ACP agent 開始跑 →
  acpx runtime 吐出 session/update 事件 →
    PetBrain 把事件翻譯成寵物狀態 →
      寵物動畫 + 氣泡台詞即時演出
  （中途 agent 要寫檔/跑指令 → request_permission → 寵物跑來問你要不要）
```

寵物不是裝飾,是「你看得懂的 agent 活動監視器」,只是長成一隻會撒嬌的生物。

## 技術選型（配合你熟的 stack）

- **Electron + TypeScript**:透明、無邊框、always-on-top、可拖動的桌寵視窗是 Electron 的標準玩法;你 japan-trip-bot 就是 TS,上手快。
- **[acpx](https://github.com/openclaw/acpx) 的 `acpx/runtime`**:直接 `import` 進 main process,用 `startTurn()` / `runTurn()` 開 session,拿 `onPermissionRequest` callback 和 `--format json` 的 NDJSON 事件流。不必自己實作 ACP 協定。
- **寵物美術**:MVP 先用純 CSS / 像素 sprite(參考 qq-slime-pet「zero assets」做法),之後再換成一張 spritesheet。
- **狀態存檔**:一個本機 JSON(原子寫入,沿用你 japan-trip-bot 的 `store.ts` 思路),存寵物的等級、心情、完成的任務數。
- **全程本機**,不連雲端(agent 用本機 Ollama 或你已登入的 Claude Code/Codex 皆可)。

> ⚠️ acpx 還沒到 1.0,CLI 和 runtime 介面會變。鎖版本,升級前先看 changelog。

---

## 架構

```
Electron main process
├─ AcpSession（包 acpx/runtime）
│    ├─ 開 session、送 prompt、收 session/update 事件
│    └─ onPermissionRequest → 轉給 PetBrain → 等 renderer 回覆
├─ PetBrain（狀態機 + tamagotchi 數值）
│    ├─ 事件 → 寵物狀態映射表（本計畫的心臟）
│    ├─ needs 數值衰減（energy / boredom / xp）
│    └─ 存檔讀檔
└─ IPC ↔ renderer

Electron renderer（透明視窗）
├─ 寵物動畫（依狀態切 sprite）
├─ 氣泡台詞（唸出牠在做什麼）
├─ 權限請求 UI（核准 / 拒絕 兩顆鈕）
└─ 互動：摸摸 / 餵任務 / 玩 / 睡覺
```

---

## 寵物狀態映射表（整個專案的靈魂）

把 ACP 事件翻成動作。先把這張表想清楚,其他都是工。

| ACP 事件 / 情境 | 寵物狀態 | 動畫 | 氣泡台詞範例 |
|---|---|---|---|
| 沒有進行中的 turn | `idle` | 待機、偶爾眨眼 | （無） |
| 閒置超過 N 分鐘 | `bored` / `hungry` | 無聊打滾、肚子叫 | 「好無聊喔…給我個任務嘛」 |
| 收到 prompt / plan 建立 | `thinking` | 頭上冒燈泡、踱步 | 「讓我想想怎麼做…」 |
| `tool_call` kind=read/search | `reading` | 翻書 / 拿放大鏡 | 「我讀一下 `foo.ts`」 |
| `tool_call` kind=edit | `typing` | 瘋狂打字 | 「改 3 個檔案中…」 |
| `tool_call` kind=execute（terminal） | `hammering` | 敲榔頭 / 冒煙 | 「跑 `pytest`…」 |
| `tool_call` kind=fetch | `peeking` | 拿望遠鏡看遠方 | 「上網查個資料」 |
| `request_permission` | `tugging` | 跑到游標旁拉你衣角、舉牌子 | 「牠想跑這個指令,可以嗎?」 |
| turn 成功結束 / 測試全綠 | `happy` | 開心跳 + 愛心 | 「搞定!誇我」 |
| turn 失敗 / error / rollback | `sick` | 變灰、頭上烏雲 | 「唔…出錯了,我回滾了」 |
| 權限被拒 / 被 cancel | `sulking` | 轉過去生悶氣 | 「哼,不給我做」 |
| 完成 N 個任務 | `levelup` | 進化特效 | 「我升級啦!」 |

> `tool_call` 的 `kind` 由 ACP 事件帶出來(read/edit/execute/fetch…),這是把「牠在做什麼」演得像的關鍵。拿不到 kind 時退回用 tool title 的關鍵字猜。

---

## Tamagotchi 數值層（讓牠像「養的」而不只是儀表板）

| 數值 | 怎麼變 | 影響 |
|---|---|---|
| `energy` 體力 | 工作(tool call)時下降,睡覺回復 | 太低 → 動作變慢、打哈欠 |
| `boredom` 無聊值 | 閒置時上升,給任務歸零 | 太高 → 主動來煩你要任務 |
| `xp` / `level` | 每完成一個 turn +xp | 到門檻就進化(換 sprite) |
| `mood` 心情 | 成功 +、失敗 / 被拒 − | 決定待機時的表情 |
| `streak` 連續成功 | 連續 turn 成功累加,一失敗歸零 | 高 streak 解鎖特別動畫 |

存成 `~/.acp-pet/save.json`,原子寫入,崩潰不壞檔。

---

## 互動設計

- **摸摸**:點寵物 → 開心,`mood` +。
- **餵任務**:雙擊 / 右鍵 → 跳出輸入框打 prompt → 送進 ACP session（這就是「餵食」）。
- **玩**:閒置時丟小把戲(追游標、翻滾)。
- **睡覺 / 收工**:暫停 session,寵物睡覺,`energy` 回復。
- **權限請求**:`request_permission` 來時,寵物跑到游標旁舉牌,牌子上寫要做的事(指令 / diff 摘要),兩顆鈕「准 / 不准」。**超時(例如 60 秒)沒點就自動拒絕(Fail-Closed)**。
- **日記**:牠默默記下今天做完哪些任務,點托盤圖示可以看「寵物日記」。

---

## 分階段實作

> 2026-10-05 進度:階段 0–5 全部完成。測試:98 個單元/整合測試、Electron smoke 17 項(每個動作、三種外表、縮放、TTS、接力賽、比賽)、接真 Claude Code 的 live 測試(單次任務 + 兩棒接力)皆通過。

### 階段 0：環境（半天）
- [x] Electron + TS 專案骨架,一個透明、frameless、always-on-top、可拖動的視窗。
- [x] ~~視窗裡先放一顆會跟著狀態變色的圓~~(直接做成像素小雞)(紅=idle、黃=working、綠=happy),純測 IPC。

### 階段 1：假事件驅動的寵物（1–2 晚）
- [x] 先**不接真 agent**,寫一個 `FakeEventSource` 照時間軸吐假的 `session/update`(thinking → read → edit → execute → done)。
- [x] 做出 PetBrain 狀態機 + 上面那張映射表,讓圓圈 / 簡單 sprite 跟著演。
- [x] 加氣泡台詞。
- **這階段做完,整個「演出」的爽感就成立了**,之後接真 agent 只是換資料源。

### 階段 2：接上真 ACP agent（1 週）
- [x] `import` `acpx/runtime`,用你本機已裝的 agent(Claude Code / Codex / Pi)開 session。
- [x] 把真的 `session/update` 事件接進 PetBrain,取代 FakeEventSource。
- [x] 實作「餵任務」輸入框 → `startTurn(prompt)`。
- [x] 實作 `onPermissionRequest` → 寵物舉牌 → renderer 回覆 → 60 秒超時自動拒絕。
- [x] **安全**:acpx 文件明說自己不是沙箱。所以:
  - session 的 `--cwd` 限定在一個白名單練習目錄,不給碰 `~/.ssh`、公司專案。
  - 預設權限 policy:讀 / 搜尋自動准,編輯 / 執行要人工點,其他拒絕。
  - 最好讓 agent 跑在獨立 WSL 使用者或容器。

### 階段 3：Tamagotchi 數值 + 存檔（2–3 晚）
- [x] energy / boredom / xp / mood / streak 的衰減與事件連動。
- [x] 存檔讀檔(原子寫入)。
- [x] 閒置太久主動來討任務;升級進化特效。

### 階段 4：美術與打磨（看熱情）
- [x] 把圓圈換成像素 sprite(可以自己畫、或用生圖工具生一張 spritesheet)。
- [x] 托盤選單:顯示/隱藏、開日記、設定、離開。
- [x] 記住視窗位置、縮放(75%–200%)、置頂開關。

### 階段 5：炫技加分題（純爽）
- [x] **多寵物**:同時開兩個 agent(Claude vs Codex),桌面養兩隻,哪隻先完成任務哪隻先進化——接到你之前的「死鬥場」點子。
- [x] **TTS**:氣泡台詞唸出來。
- [x] **接力賽**:`/flow a >> b >> c` 在同一個 session 一棒接一棒跑,寵物演出每一棒。沒用 acpx 的 `FlowRunner`:它沒有即時事件和權限 callback,會讓寵物看不到、也沒辦法舉牌。
- [x] **換膚**:內建配色、自己的圖片資料夾(每個動作一張)、OpenPet / Codex pet 角色包。

---

## 完成標準（MVP）

- [x] 桌面有一隻透明、可拖動的寵物。
- [x] 丟一個任務,寵物會依 agent 真實進度切換「想 → 讀 → 改 → 跑 → 成功/失敗」的動作與台詞。
- [x] agent 要寫檔或跑指令時,寵物來舉牌問你,超時自動拒絕。
- [x] 完成任務會加 xp,會進化;閒太久會來討任務;狀態能存檔。

## 風險與注意

| 風險 | 對策 |
|---|---|
| acpx pre-1.0 介面會變 | 鎖版本,把對接集中在一個 `AcpSession` 檔,改動好收斂 |
| agent 在你電腦亂改檔 | cwd 白名單 + 預設拒絕 + 容器/獨立使用者（acpx 不是沙箱） |
| 拿不到 tool_call 的 kind | 退回用 tool title 關鍵字猜 read/edit/run |
| 事件太密集動畫會抖 | PetBrain 設最短停留時間,狀態切換做節流 |
| Electron 透明視窗在不同 OS 行為不一 | 先鎖定 Windows（你的主力),macOS 之後再說 |

## 參考

- acpx（runtime / permissions / flows）：<https://github.com/openclaw/acpx>
- ACP 規格：<https://github.com/agentclientprotocol/agent-client-protocol>（`docs/protocol/v1/` 的 `tool-calls`、`prompt-turn`）
- 現有桌寵參考（借美術 / 看互動,不是抄本體）：
  - miku-on-desktop（最成熟,有 acp_delegate）：<https://github.com/thunguo/miku-on-desktop>
  - codex-has-a-pet-too（MCP App 小貓）：<https://github.com/ChenxiChu001/codex-has-a-pet-too>
  - OpenPet（角色包 / 平台）：<https://github.com/dengyie/OpenPet>
  - qq-slime-pet（純 CSS 像素 sprite 做法）：<https://github.com/DTSFO/qq-slime-pet>
