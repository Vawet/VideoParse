import type { ChatAnswer } from "./types";

export type QaEntry = {
  id: string;
  /** Matched against the question text — the first entry with a hit wins. */
  keywords: string[];
  answer: ChatAnswer;
};

export const EXAMPLE_QUESTIONS = [
  "为什么点积要除以 √d_k?",
  "多头注意力比单头好在哪?",
  "位置编码为什么用正弦函数?",
  "注意力权重能当作模型解释吗?",
  "RNN 和 Transformer 的主要区别是什么?",
];

export const QA_ENTRIES: QaEntry[] = [
  {
    id: "qa-scale",
    keywords: ["√d", "dk", "sqrt", "缩放", "点积", "除以", "方差"],
    answer: {
      text: "因为点积的方差会随维度增长,不加缩放时 softmax 会被推到接近 one-hot 的形状,反传的梯度几乎消失。",
      bullets: [
        "Q · Kᵀ 的每一项是 d_k 个乘积之和,方差随 d_k 线性增大;",
        "方差大 → 相似度差距被放大 → softmax 饱和 → 梯度趋近 0;",
        "除以 √d_k 等于把方差拉回 1 附近,让分布保持“可学习”。",
      ],
      citations: [
        {
          segmentId: "s4",
          time: 1210,
          quote: "当 d_k 变大,点积的方差随之变大,softmax 会挤成接近 one-hot 的分布,梯度几乎消失。",
          slideId: "s3",
        },
        {
          segmentId: "s4",
          time: 1050,
          quote: "分子是点积,分母是 √d_k……相当于把方差拉回 1 附近。",
          slideId: "s3",
        },
      ],
    },
  },
  {
    id: "qa-multihead",
    keywords: ["多头", "multi", "单头", "head"],
    answer: {
      text: "单头注意力一次只能学出一种关注方式,多头把 d_model 切成若干份并行计算,让模型在同一层里同时观察相邻词、句法依存和远距离指代。",
      bullets: [
        "每个头在更低的维度 d_model / h 上做注意力,总计算量与单头基本持平;",
        "所有头的输出拼接后再过一次线性映射,信息重新融合;",
        "代价是单层权重不再能讲成一个完整的故事,可解释性变弱。",
      ],
      citations: [
        {
          segmentId: "s5",
          time: 1520,
          quote: "不同头常常自发分工:有的盯相邻词,有的盯句法依存,有的盯远距离指代。",
        },
        {
          segmentId: "s5",
          time: 1630,
          quote: "多头把 d_model 切成 h 份,每份独立做一次注意力,再拼接、过一层线性映射。",
        },
      ],
    },
  },
  {
    id: "qa-positional",
    keywords: ["位置编码", "顺序", "正弦", "sin", "cos", "位置"],
    answer: {
      text: "因为自注意力本身对顺序不敏感:把输入打乱,输出只是跟着打乱。要让模型知道“谁在前”,就必须把位置信息显式加进去。",
      bullets: [
        "正弦编码用不同频率的 sin / cos 组合,让每个位置有一组唯一的值;",
        "低频维度变化慢,表示粗粒度位置;高频维度变化快,表示精细位置;",
        "相对位置可以由正弦编码线性变换得到,因此能外推到训练时没见过的长度。",
      ],
      citations: [
        {
          segmentId: "s6",
          time: 1960,
          quote: "自注意力本身对顺序是“无感”的:把输入打乱,输出只是跟着打乱。",
          slideId: "s4",
        },
        {
          segmentId: "s6",
          time: 2160,
          quote: "频率低的维度变化慢,负责粗粒度位置;频率高的维度变化快,负责精细位置。",
          slideId: "s4",
        },
      ],
    },
  },
  {
    id: "qa-explain",
    keywords: ["解释", "可解释", "权重", "重要"],
    answer: {
      text: "课程里的结论是不成立:权重只说明信息流动得多,不能直接读成因果上的重要。",
      bullets: [
        "注意力权重经过 softmax 归一化,总和固定,权重之间是此消彼长的关系;",
        "不同头可能互相补偿,单看一个头容易误判;",
        "更可靠的做法是配合消融实验或梯度类归因方法一起看。",
      ],
      citations: [
        {
          segmentId: "s8",
          time: 2660,
          quote: "权重高只说明信息流动得多,不等于因果上重要。",
        },
        {
          segmentId: "s8",
          time: 2700,
          quote: "不同头之间也可能互相补偿,单看一层权重容易得出误导性的结论。",
        },
      ],
    },
  },
  {
    id: "qa-rnn",
    keywords: ["rnn", "循环", "lstm", "区别", "对比"],
    answer: {
      text: "最本质的差别在于信息怎么流动:RNN 逐跳传递,自注意力一次直达。",
      bullets: [
        "RNN:每层 O(n · d²),任意两步距离 O(n),无法并行;",
        "自注意力:每层 O(n² · d),任意两步距离 O(1),可以并行;",
        "代价是在长序列上显存与计算量随 n² 增长,这也是各种稀疏与线性注意力的由来。",
      ],
      citations: [
        {
          segmentId: "s2",
          time: 320,
          quote: "循环网络把整段历史压进一个固定长度的隐状态,序列越长,早期信息被稀释得越厉害。",
          slideId: "s1",
        },
        {
          segmentId: "s2",
          time: 430,
          quote: "自注意力让任意两步之间只有一跳,而且整段可以并行计算。",
        },
      ],
    },
  },
];

const FALLBACK: ChatAnswer = {
  text: "这段视频里没有和问题完全对应的片段,先给你三处最相关的内容。需要更细的答案,可以换成具体一点的说法再问一次。",
  bullets: [
    "如果问的是“为什么”,第 2 节讲了 RNN 的固定长度瓶颈;",
    "如果问的是“怎么算”,第 4 节从投影一路推到加权求和;",
    "如果问的是概念辨析,第 8 节列了三个常见误区。",
  ],
  citations: [
    {
      segmentId: "s2",
      time: 240,
      quote: "瓶颈来自结构:所有历史都必须压进同一个固定长度的状态里。",
      slideId: "s1",
    },
    {
      segmentId: "s4",
      time: 1080,
      quote: "先算 Q 与 Kᵀ 的乘积,得到一张 n×n 的相似度矩阵。",
      slideId: "s3",
    },
  ],
};

/** Keyword retrieval over the mock transcript — the shape a real retriever returns. */
export function answerQuestion(question: string): ChatAnswer {
  const normalized = question.toLowerCase();
  const hit = QA_ENTRIES.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
  return hit ? hit.answer : FALLBACK;
}
