/**
 * Mock grader for the "以教代学" tab: the learner explains a concept in their own
 * words and gets structured feedback about which points they covered.
 */

export type TeachConcept = {
  id: string;
  label: string;
  segmentId: string;
  time: number;
  /** Points the explanation should contain, with the words that signal them. */
  points: { label: string; keywords: string[]; hint: string }[];
};

export type TeachFeedback = {
  score: number;
  covered: string[];
  missed: { label: string; hint: string }[];
  suggestions: string[];
};

export const TEACH_CONCEPTS: TeachConcept[] = [
  {
    id: "tc-qkv",
    label: "Q / K / V 的分工",
    segmentId: "s3",
    time: 585,
    points: [
      {
        label: "Query 提出要找什么",
        keywords: ["query", "查询", "提问", "问题"],
        hint: "先说清 Query 是“提问的一方”。",
      },
      {
        label: "Key 是被匹配的索引",
        keywords: ["key", "键", "索引", "标签", "匹配"],
        hint: "再说明 Key 提供被比较的索引。",
      },
      {
        label: "Value 是取回的内容",
        keywords: ["value", "值", "内容", "取回"],
        hint: "别漏掉真正被加权求和的是 Value。",
      },
      {
        label: "三者来自同一输入的三个投影",
        keywords: ["投影", "矩阵", "wq", "wk", "wv", "同一个", "同一段", "输入"],
        hint: "补充它们都由同一段输入经三个矩阵得到。",
      },
    ],
  },
  {
    id: "tc-scale",
    label: "为什么要除以 √d_k",
    segmentId: "s4",
    time: 1210,
    points: [
      {
        label: "点积的方差随维度增大",
        keywords: ["方差", "维度", "d_k", "dk", "点积"],
        hint: "从点积方差与维度的关系说起。",
      },
      {
        label: "softmax 会饱和成 one-hot",
        keywords: ["softmax", "饱和", "one-hot", "极端", "分布"],
        hint: "解释方差变大后 softmax 的形状变化。",
      },
      {
        label: "梯度消失,训练变难",
        keywords: ["梯度", "消失", "训练", "学不动", "反向"],
        hint: "把结果落到梯度上,说明为什么这是问题。",
      },
      {
        label: "缩放把方差拉回量级 1",
        keywords: ["缩放", "拉回", "1", "归一", "稳"],
        hint: "最后说明除以 √d_k 的具体作用。",
      },
    ],
  },
  {
    id: "tc-multihead",
    label: "多头注意力",
    segmentId: "s5",
    time: 1450,
    points: [
      {
        label: "把 d_model 切分成 h 份",
        keywords: ["d_model", "切", "分", "几个头", "h", "维度"],
        hint: "先讲多头是怎么切维度的。",
      },
      {
        label: "每个头独立做一次注意力",
        keywords: ["独立", "各自", "分别", "每个头"],
        hint: "强调各头并行、互不共享投影。",
      },
      {
        label: "拼接后再线性映射",
        keywords: ["拼接", "concaten", "线性", "映射", "输出"],
        hint: "别忘了输出端还有拼接与线性层。",
      },
      {
        label: "不同类型的关注分工",
        keywords: ["分工", "关注", "局部", "依存", "指代", "视角"],
        hint: "举例说明不同头学到了什么。",
      },
    ],
  },
  {
    id: "tc-positional",
    label: "位置编码的必要性",
    segmentId: "s6",
    time: 1960,
    points: [
      {
        label: "自注意力对顺序不敏感",
        keywords: ["顺序", "不敏感", "置换", "打乱", "无感"],
        hint: "先说清问题的根源在置换等变性上。",
      },
      {
        label: "顺序信息必须显式注入",
        keywords: ["注入", "加", "显式", "位置编码", "位置信息"],
        hint: "说明解决办法是显式加入位置表示。",
      },
      {
        label: "不同频率对应不同粒度",
        keywords: ["频率", "粒度", "粗", "细", "正弦", "sin"],
        hint: "解释正弦编码里频率高低的作用。",
      },
    ],
  },
];

export function gradeTeaching(text: string, concept: TeachConcept): TeachFeedback {
  const normalized = text.toLowerCase();
  const covered: string[] = [];
  const missed: { label: string; hint: string }[] = [];

  for (const point of concept.points) {
    const hit = point.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
    if (hit) covered.push(point.label);
    else missed.push({ label: point.label, hint: point.hint });
  }

  const coverage = covered.length / concept.points.length;
  // A very short answer is capped, otherwise length alone would inflate the score.
  const lengthFactor = text.trim().length < 60 ? 0.75 : 1;
  const score = Math.round(Math.min(1, coverage * lengthFactor + 0.15) * 100);

  const suggestions: string[] = [];
  if (missed.length > 0) suggestions.push(`补上「${missed[0].label}」:${missed[0].hint}`);
  if (missed.length > 1) suggestions.push(`再补一句「${missed[1].label}」,讲解会更完整。`);
  if (text.trim().length < 60) suggestions.push("把讲解写长一点,尽量用完整的因果关系说明,而不是列出关键词。");
  if (suggestions.length === 0) suggestions.push("要点覆盖得很完整,可以试着加一个反例,说明这个机制在什么情况下会失效。");

  return { score, covered, missed, suggestions };
}
