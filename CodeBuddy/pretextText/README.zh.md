# Pretext 文字 MVP

使用 [@chenglou/pretext](https://github.com/chenglou/pretext) 的两个独立示例，浏览器直接打开，无需构建。

## 入口

打开 [index.html](./index.html) 选择示例。

## 文件说明

| 文件 | 说明 |
|------|------|
| `index.html` | 导航页 |
| `auto-fit.html` + `auto-fit.js` | **HTML 排版 + Pretext 只算字号** |
| `noodle-drag.html` + `noodle-drag.js` | **面条拖拽**（Canvas + 软体物理） |
| `noodle-drag-advanced.html` + `noodle-drag-advanced.js` | **按行软化 + S 形连接 + 碰撞** |

### 自动计算字号（auto-fit）

- **Pretext**：`prepareWithSegments` + `layoutWithLines`，二分搜索最大 `font-size`，并按词断行
- **HTML**：每行一个 `<div class="fit-line">`（`white-space: nowrap`），由 Pretext 决定断行位置，避免浏览器二次折行导致分词不一致

### 面条拖拽（noodle-drag）

- **Pretext**：每段 `measureNaturalWidth` 作为链节静息长度
- **Canvas**：Verlet + 距离约束；鼠标拖拽质点

### 面条拖拽进阶（noodle-drag-advanced）

- **Pretext**：`layoutWithLines` 自动换行，每行独立链
- **点击软化**：点哪行哪行变面条，其余保持刚性横排
- **S 形连接**：行1尾↔行2尾、行2头↔行3头、行3尾↔行4尾……
- **碰撞**：面条行质点之间互相排斥，避免重叠

## 参考

- [Pretext GitHub](https://github.com/chenglou/pretext)
- [Pretext 社区 Demo](https://www.pretext.cool/)
