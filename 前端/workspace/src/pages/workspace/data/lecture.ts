import motivationSlide from "@/assets/demo-slides/slide-1.webp";
import qkvSlide from "@/assets/demo-slides/slide-2.webp";
import scaledDotSlide from "@/assets/demo-slides/slide-3.webp";
import positionalSlide from "@/assets/demo-slides/slide-4.webp";
import { formatTime } from "@/lib/format";
import type { LectureData, MindmapNode, Segment } from "./types";

const NOTES_MARKDOWN = `本课用 46 分钟回答一个问题:**如果不按顺序读完整段输入,模型怎么知道该看哪里?** 下面按课程顺序整理,每段末尾的时间戳都可以点击,点了就回到视频对应位置。

## 课程导览:这门课能带你走到哪

课程只有一条主线:从"为什么需要注意力"出发,拆开 Q / K / V 三个角色,推导缩放点积注意力,最后拼出一个 Transformer 编码层。

走到最后,你应该能自己写出注意力的矩阵形状,并说清 \`softmax\` 之前为什么要除以 √d_k。[00:00](#t=0)

## 为什么需要注意力机制

循环网络把整段历史压进一个固定长度的隐状态。序列越长,早期信息被反复稀释,传到后面几乎不剩多少。

视频里用 8 步的玩具例子演示了一遍:第 1 步的信息走到第 8 步时,权重只剩下个位数百分比。

> 注意力把"回忆"从串行传递改成一次直接检索:任意两步之间只有一跳。

![RNN 的信息瓶颈](#slide-s1)

结论不是"RNN 不够大",而是固定长度瓶颈这个结构本身在长序列上不划算。[03:20](#t=200)

### 两种结构的代价

| 结构 | 单层复杂度 | 任意两步的距离 | 能否并行 |
| --- | --- | --- | --- |
| RNN / LSTM | O(n · d²) | O(n) | 否 |
| 自注意力 | O(n² · d) | O(1) | 是 |

## Q / K / V 的直觉:一次检索

把注意力想成一次搜索:

- **Query(查询)**:你手上要解决的问题;
- **Key(键)**:每个位置挂出来的索引标签;
- **Value(值)**:真正被取回、并被加权求和的内容。

每算一步,每个位置都会用自己的 Query 和所有位置的 Key 比对,得到一组相似度;相似度归一化之后,就成为这一位置对别处的注意力权重。

![Q / K / V 的检索类比](#slide-s2)

要注意 Query、Key、Value 都是同一段输入乘上三个不同矩阵得到的,也就是说"检索"发生在句子内部。[09:45](#t=585)

## 缩放点积注意力怎么算

1. 用输入分别乘 W_q、W_k、W_v,得到 Q、K、V;
2. 计算 Q 与 Kᵀ 的乘积,得到一张 n×n 的相似度矩阵;
3. 除以 √d_k,再对每一行做 \`softmax\`;
4. 用归一化后的权重对 V 加权求和。

![缩放点积注意力公式](#slide-s3)

分子是点积,分母是 √d_k。为什么必须缩放:当 d_k 变大,点积的方差随之变大,\`softmax\` 会挤成接近 one-hot 的分布,梯度几乎消失;除以 √d_k 相当于把方差拉回 1 附近。[16:30](#t=990)

## 多头注意力:多个视角并行

单头只能学出一种"关注方式"。多头把 d_model 切成 h 份,每份独立做一次注意力,再拼接、过一层线性映射。

- 不同头常常自发分工:有的盯相邻词,有的盯句法依存,有的盯远距离指代;
- 总计算量与单头相当,因为每头的维度被降到 d_model / h;
- 代价是同一层的注意力权重不再能直接讲成一个完整故事。[24:10](#t=1450)

## 位置编码:给序列注入顺序

自注意力本身对顺序是"无感"的:把输入打乱,输出只是跟着打乱。顺序信息必须显式注入。

![正弦位置编码](#slide-s4)

视频里用的是正弦编码:每个位置给出一组不同频率的 sin / cos 值。频率低的维度变化慢,负责粗粒度位置;频率高的维度变化快,负责精细位置。额外好处是相对位置可以通过线性变换得到,模型因此能处理训练时没见过的更长序列。[31:40](#t=1900)

## 从注意力到 Transformer 层

一个编码层 = 多头自注意力 + 残差连接 + LayerNorm + 前馈网络,外面再套一层残差与归一化。堆叠若干层之后,浅层偏向局部形态,深层偏向语义与任务。[38:05](#t=2285)

## 小结与三个常见误区

- **误区一**:注意力权重就等于解释。权重高只说明信息流动得多,不等于因果上重要;
- **误区二**:必须用正弦位置编码。可学习位置嵌入同样常用,长文本场景还常见 RoPE 与 ALiBi;
- **误区三**:注意力一定优于 RNN。小数据、短序列、严格流式的场景里,循环结构仍有优势。

复习时优先用下面的测验与复习标签,把"看懂了"变成"说得出"。[43:20](#t=2600)
`;

const SEGMENTS: Segment[] = [
  {
    id: "s1",
    start: 0,
    end: 200,
    title: "课程导览:这门课能带你走到哪",
    summary: "用一条主线串起动机、Q / K / V、缩放点积与编码层,先给全课地图。",
  },
  {
    id: "s2",
    start: 200,
    end: 585,
    title: "为什么需要注意力机制",
    summary: "RNN 的固定长度隐状态把长序列信息稀释掉,注意力用一次检索取代串行传递。",
  },
  {
    id: "s3",
    start: 585,
    end: 990,
    title: "Q / K / V 的直觉:一次检索",
    summary: "Query 提问、Key 做索引、Value 提供内容,三者都由同一段输入投影而来。",
  },
  {
    id: "s4",
    start: 990,
    end: 1450,
    title: "缩放点积注意力怎么算",
    summary: "四步走完从投影到加权求和,重点是除以 √d_k 让 softmax 不发散。",
  },
  {
    id: "s5",
    start: 1450,
    end: 1900,
    title: "多头注意力:多个视角并行",
    summary: "把维度切份、各头独立注意、再拼接映射;收益是多种关注方式,代价是可解释性。",
  },
  {
    id: "s6",
    start: 1900,
    end: 2285,
    title: "位置编码:给序列注入顺序",
    summary: "自注意力对顺序不敏感,正弦编码用不同频率的波形给每个位置一个指纹。",
  },
  {
    id: "s7",
    start: 2285,
    end: 2600,
    title: "从注意力到 Transformer 层",
    summary: "残差 + LayerNorm + 前馈网络包住多头注意力,堆叠成编码器。",
  },
  {
    id: "s8",
    start: 2600,
    end: 2772,
    title: "小结与三个常见误区",
    summary: "权重不等于解释、正弦不是唯一、注意力也不绝对优于 RNN。",
  },
];

const MINDMAP: MindmapNode = {
  id: "root",
  label: "注意力机制与 Transformer",
  time: 0,
  children: [
    {
      id: "m-motive",
      label: "动机",
      time: 200,
      children: [
        { id: "m-motive-1", label: "固定长度隐状态", time: 240 },
        { id: "m-motive-2", label: "长距离依赖衰减", time: 320 },
        { id: "m-motive-3", label: "可并行计算", time: 430 },
      ],
    },
    {
      id: "m-qkv",
      label: "Q / K / V",
      time: 585,
      children: [
        { id: "m-qkv-1", label: "三个投影矩阵", time: 640 },
        { id: "m-qkv-2", label: "相似度与归一化", time: 760 },
        { id: "m-qkv-3", label: "句子内部检索", time: 900 },
      ],
    },
    {
      id: "m-calc",
      label: "缩放点积注意力",
      time: 990,
      children: [
        { id: "m-calc-1", label: "Q · Kᵀ 相似度矩阵", time: 1080 },
        { id: "m-calc-2", label: "除以 √d_k 抑制饱和", time: 1210 },
        { id: "m-calc-3", label: "按行 softmax 再乘 V", time: 1330 },
      ],
    },
    {
      id: "m-multi",
      label: "多头注意力",
      time: 1450,
      children: [
        { id: "m-multi-1", label: "切分 d_model / h", time: 1520 },
        { id: "m-multi-2", label: "拼接 + 线性映射", time: 1630 },
        { id: "m-multi-3", label: "各头的自发分工", time: 1750 },
      ],
    },
    {
      id: "m-pos",
      label: "位置编码",
      time: 1900,
      children: [
        { id: "m-pos-1", label: "自注意力对顺序无感", time: 1960 },
        { id: "m-pos-2", label: "频率高低对应粒度", time: 2060 },
        { id: "m-pos-3", label: "相对位置线性可得", time: 2160 },
      ],
    },
    {
      id: "m-layer",
      label: "Transformer 层",
      time: 2285,
      children: [
        { id: "m-layer-1", label: "残差 + LayerNorm", time: 2340 },
        { id: "m-layer-2", label: "前馈网络", time: 2450 },
        { id: "m-layer-3", label: "堆叠的层次分化", time: 2520 },
      ],
    },
    {
      id: "m-review",
      label: "复习要点",
      time: 2600,
      children: [
        { id: "m-review-1", label: "权重 ≠ 解释", time: 2660 },
        { id: "m-review-2", label: "位置编码的多种选择", time: 2700 },
        { id: "m-review-3", label: "什么时候仍用 RNN", time: 2740 },
      ],
    },
  ],
};

const BASE: LectureData = {
  id: "lecture-attention",
  title: "注意力机制与 Transformer 入门",
  subtitle: "机器学习公开课 · 第 3 讲",
  duration: 2772,
  stats: { words: 2380, framesTotal: 128, framesKept: 4 },
  overview: {
    summary:
      "这一讲把注意力机制从“为什么要它”讲到“怎么算出来”。先用 RNN 的固定长度瓶颈说明动机,再拆开 Q / K / V 三个角色,推导缩放点积注意力与多头机制,最后补上位置编码并拼成一个 Transformer 编码层。",
    keyPoints: [
      "RNN 的瓶颈是结构性的:信息必须逐跳流过固定长度的隐状态。",
      "注意力把回忆变成一次检索,任意两步之间只有一跳,而且可以并行。",
      "除以 √d_k 不是细节:它决定 softmax 会不会饱和、梯度还在不在。",
      "多头把维度切份并行,不同头自发承担局部、句法与指代等不同分工。",
      "自注意力对顺序无感,位置编码是顺序信息的唯一来源。",
    ],
    glossary: [
      { term: "Query / Key / Value", definition: "同一段输入经三个投影矩阵得到的三组表示,分别承担提问、索引与内容。" },
      { term: "缩放点积注意力", definition: "softmax(QKᵀ / √d_k)V,用点积衡量相似度并加权取回内容。" },
      { term: "多头注意力", definition: "把 d_model 切成 h 份并行做注意力,再拼接并线性映射。" },
      { term: "位置编码", definition: "注入序列顺序信息的向量,正弦编码与可学习嵌入最常见。" },
      { term: "残差连接", definition: "把子层输入与子层输出相加,让深堆叠仍能稳定训练。" },
      { term: "LayerNorm", definition: "在特征维度上做归一化,稳定激活分布。" },
    ],
  },
  segments: SEGMENTS,
  notesMarkdown: NOTES_MARKDOWN,
  mindmap: MINDMAP,
  slides: [
    {
      id: "s1",
      time: 312,
      image: motivationSlide,
      title: "RNN 的信息瓶颈",
      caption: "长距离依赖在逐跳传递中被稀释;注意力让任意两步直接相连。",
      segmentId: "s2",
    },
    {
      id: "s2",
      time: 760,
      image: qkvSlide,
      title: "Q / K / V 的检索类比",
      caption: "Query 是要找的问题,Key 是索引,Value 是真正取回的内容。",
      segmentId: "s3",
    },
    {
      id: "s3",
      time: 1265,
      image: scaledDotSlide,
      title: "缩放点积注意力公式",
      caption: "除以 √d_k 让相似度分布保持可训练,矩阵形状也随之写清。",
      segmentId: "s4",
    },
    {
      id: "s4",
      time: 1998,
      image: positionalSlide,
      title: "正弦位置编码",
      caption: "不同频率的正弦波叠加,让每个位置拥有唯一指纹。",
      segmentId: "s6",
    },
  ],
  quiz: [
    {
      id: "q1",
      kind: "choice",
      segmentId: "s2",
      time: 210,
      question: "在长序列上,RNN 的主要瓶颈是什么?",
      options: [
        { id: "a", label: "参数总量太小,拟合能力不足" },
        { id: "b", label: "固定长度的隐状态让早期信息被反复稀释" },
        { id: "c", label: "无法使用 GPU 加速" },
        { id: "d", label: "词表规模限制了上下文长度" },
      ],
      answerId: "b",
      explanation: "瓶颈来自结构:所有历史都必须压进同一个固定长度的状态里。",
    },
    {
      id: "q2",
      kind: "choice",
      segmentId: "s3",
      time: 640,
      question: "在注意力的检索类比里,Key 更接近哪一项?",
      options: [
        { id: "a", label: "最终被取回的内容" },
        { id: "b", label: "挂在每个位置上的索引标签" },
        { id: "c", label: "归一化用的系数" },
        { id: "d", label: "位置编码向量" },
      ],
      answerId: "b",
      explanation: "Key 负责被 Query 匹配,匹配程度决定权重;内容由 Value 提供。",
    },
    {
      id: "q3",
      kind: "choice",
      segmentId: "s4",
      time: 1120,
      question: "除以 √d_k 的直接目的是什么?",
      options: [
        { id: "a", label: "把输出范围压到 0–1" },
        { id: "b", label: "抑制点积方差,避免 softmax 饱和导致梯度消失" },
        { id: "c", label: "减少可训练参数量" },
        { id: "d", label: "让矩阵乘法更快" },
      ],
      answerId: "b",
      explanation: "d_k 越大点积方差越大,softmax 越接近 one-hot;缩放把方差拉回 1 附近。",
    },
    {
      id: "q4",
      kind: "choice",
      segmentId: "s4",
      time: 1210,
      question: "自注意力权重矩阵的形状是?",
      options: [
        { id: "a", label: "d_model × d_model" },
        { id: "b", label: "n × n(n 为序列长度)" },
        { id: "c", label: "n × d_v" },
        { id: "d", label: "d_k × d_v" },
      ],
      answerId: "b",
      explanation: "每个位置对每个位置都要有一个权重,所以是 n×n;对后面乘 V 得到 n×d_v。",
    },
    {
      id: "q5",
      kind: "choice",
      segmentId: "s5",
      time: 1520,
      question: "多头注意力的总计算量为什么与单头接近?",
      options: [
        { id: "a", label: "因为跳过了 softmax" },
        { id: "b", label: "因为每个头的维度被降到 d_model / h" },
        { id: "c", label: "因为所有头共享同一份 Value" },
        { id: "d", label: "因为多头只在第一层使用" },
      ],
      answerId: "b",
      explanation: "切分维度后每头更小,总规模与单头大致相当。",
    },
    {
      id: "q6",
      kind: "choice",
      segmentId: "s5",
      time: 1620,
      question: "多头机制带来的主要收益是什么?",
      options: [
        { id: "a", label: "显著减少显存占用" },
        { id: "b", label: "在不同子空间里同时学到多种关注方式" },
        { id: "c", label: "保证注意力权重可解释" },
        { id: "d", label: "不再需要位置编码" },
      ],
      answerId: "b",
      explanation: "单头只能学一种关注模式,多头提供多个视角。",
    },
    {
      id: "q7",
      kind: "choice",
      segmentId: "s6",
      time: 1960,
      question: "Transformer 为什么必须要有位置编码?",
      options: [
        { id: "a", label: "自注意力本身对输入顺序不敏感" },
        { id: "b", label: "正弦函数能让训练收敛更快" },
        { id: "c", label: "词嵌入维度不够用" },
        { id: "d", label: "用来把复杂度从 O(n²) 降下来" },
      ],
      answerId: "a",
      explanation: "打乱输入顺序,注意力输出只是跟着打乱,顺序必须显式注入。",
    },
    {
      id: "q8",
      kind: "choice",
      segmentId: "s6",
      time: 2060,
      question: "正弦编码中频率较低的维度,更擅长表示什么?",
      options: [
        { id: "a", label: "精细位置差异" },
        { id: "b", label: "粗粒度位置" },
        { id: "c", label: "词性信息" },
        { id: "d", label: "句法依存" },
      ],
      answerId: "b",
      explanation: "低频维度变化慢,表示粗粒度位置;高频维度负责精细位置。",
    },
    {
      id: "q9",
      kind: "choice",
      segmentId: "s7",
      time: 2320,
      question: "一个 Transformer 编码层通常包含哪些部分?",
      options: [
        { id: "a", label: "只有多头注意力" },
        { id: "b", label: "多头注意力 + 残差 + LayerNorm + 前馈网络" },
        { id: "c", label: "卷积 + 池化" },
        { id: "d", label: "循环单元 + 门控" },
      ],
      answerId: "b",
      explanation: "注意力负责跨位置交互,前馈网络负责逐位置的变换,残差与归一化保证可训练。",
    },
    {
      id: "q10",
      kind: "choice",
      segmentId: "s8",
      time: 2680,
      question: "关于“注意力权重就是模型解释”这个说法,课程结论是什么?",
      options: [
        { id: "a", label: "成立,权重高就代表因果关键" },
        { id: "b", label: "不成立,权重只反映信息流动多少" },
        { id: "c", label: "只在编码器中成立" },
        { id: "d", label: "需要再训练一次才能成立" },
      ],
      answerId: "b",
      explanation: "权重是信息流动的量,不能直接读成因果重要性。",
    },
    {
      id: "q11",
      kind: "short",
      segmentId: "s3",
      time: 900,
      question: "用自己的话说清 Query 与 Key 如何产生注意力权重。",
      modelAnswer:
        "每个位置的 Query 与所有位置的 Key 做点积得到相似度,相似度除以 √d_k 后按行做 softmax 归一化,得到的权重表示该位置应该从别处取回多少信息。",
      explanation: "关键两步:点积衡量相似度,按行 softmax 把相似度变成和为 1 的权重。",
    },
    {
      id: "q12",
      kind: "short",
      segmentId: "s4",
      time: 1350,
      question: "写出缩放点积注意力公式,并说明 softmax 作用在哪一维。",
      modelAnswer:
        "Attention(Q, K, V) = softmax(QKᵀ / √d_k) V;softmax 沿 Key 的维度进行,也就是对相似度矩阵的每一行归一化,使每个 Query 得到一组和为 1 的权重。",
      explanation: "公式记牢之后,再记住归一化方向是“每个 Query 横向看所有 Key”。",
    },
  ],
  review: [
    {
      id: "r1",
      segmentId: "s2",
      time: 240,
      prompt: "为什么 RNN 在长序列上信息会衰减?",
      answer:
        "历史必须逐跳流过一个固定长度的隐状态,早期信息在多次变换中被稀释,梯度与语义都难以完整传到最后。",
      intervalDays: 1,
    },
    {
      id: "r2",
      segmentId: "s3",
      time: 700,
      prompt: "Query、Key、Value 各自承担什么角色?",
      answer:
        "Query 是提问,Key 是被匹配的索引,Value 是取回的内容;三者都由同一段输入乘不同投影矩阵得到。",
      intervalDays: 1,
    },
    {
      id: "r3",
      segmentId: "s4",
      time: 1050,
      prompt: "写出缩放点积注意力公式。",
      answer: "Attention(Q, K, V) = softmax(QKᵀ / √d_k) V。",
      intervalDays: 2,
    },
    {
      id: "r4",
      segmentId: "s4",
      time: 1240,
      prompt: "为什么点积要除以 √d_k?",
      answer:
        "点积方差随 d_k 增大,softmax 会饱和成 one-hot,梯度几乎消失;缩放把方差拉回 1 附近。",
      intervalDays: 2,
    },
    {
      id: "r5",
      segmentId: "s5",
      time: 1560,
      prompt: "多头注意力的收益与代价各是什么?",
      answer:
        "收益是多个子空间同时学习不同关注方式,总计算量基本不变;代价是单层权重不再能讲成一个完整解释。",
      intervalDays: 3,
    },
    {
      id: "r6",
      segmentId: "s6",
      time: 1990,
      prompt: "为什么必须显式注入位置信息?",
      answer:
        "自注意力是置换等变的:打乱输入顺序,输出只是跟着打乱,顺序信息不会自己出现。",
      intervalDays: 3,
    },
    {
      id: "r7",
      segmentId: "s7",
      time: 2360,
      prompt: "一个 Transformer 编码层由哪些部件组成?",
      answer:
        "多头自注意力 + 残差连接 + LayerNorm + 前馈网络,再包一层残差与归一化;多层堆叠形成层次化表示。",
      intervalDays: 5,
    },
    {
      id: "r8",
      segmentId: "s8",
      time: 2660,
      prompt: "把注意力权重当作解释,问题出在哪?",
      answer:
        "权重只反映信息流动的多少,不能推出因果重要性;不同头之间也可能互相补偿。",
      intervalDays: 7,
    },
  ],
};

/** First segment that contains `time` (falls back to the last one). */
export function findSegmentAt(
  segments: Segment[],
  time: number,
): { segment: Segment; index: number } {
  const index = segments.findIndex((segment) => time >= segment.start && time < segment.end);
  if (index >= 0) return { segment: segments[index], index };
  return { segment: segments[segments.length - 1], index: segments.length - 1 };
}

function scaleMindmap(node: MindmapNode, factor: number): MindmapNode {
  return {
    ...node,
    time: typeof node.time === "number" ? Math.round(node.time * factor) : undefined,
    children: node.children?.map((child) => scaleMindmap(child, factor)),
  };
}

/** Rewrites `[mm:ss](#t=sec)` references so timestamps stay truthful after rescaling. */
function scaleNotes(markdown: string, factor: number): string {
  if (factor === 1) return markdown;
  return markdown.replace(
    /\[\d{1,2}:\d{2}(?::\d{2})?\]\(#t=(\d+)\)/g,
    (_match, seconds: string) => {
      const scaled = Math.round(Number(seconds) * factor);
      return `[${formatTime(scaled)}](#t=${scaled})`;
    },
  );
}

/**
 * Rebuilds the mock lecture for a different video length, so an uploaded file
 * gets timestamps that land inside its own duration.
 */
export function buildLecture(duration: number): LectureData {
  const safeDuration = Math.max(60, Math.round(duration));
  const factor = safeDuration / BASE.duration;
  if (factor === 1) return BASE;

  return {
    ...BASE,
    duration: safeDuration,
    segments: BASE.segments.map((segment) => ({
      ...segment,
      start: Math.round(segment.start * factor),
      end: Math.round(segment.end * factor),
    })),
    slides: BASE.slides.map((slide) => ({ ...slide, time: Math.round(slide.time * factor) })),
    quiz: BASE.quiz.map((question) => ({
      ...question,
      time: Math.round(question.time * factor),
    })),
    review: BASE.review.map((card) => ({ ...card, time: Math.round(card.time * factor) })),
    mindmap: scaleMindmap(BASE.mindmap, factor),
    notesMarkdown: scaleNotes(BASE.notesMarkdown, factor),
  };
}

export const DEMO_LECTURE = BASE;
