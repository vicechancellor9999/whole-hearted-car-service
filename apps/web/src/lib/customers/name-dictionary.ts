export interface ApprovedFullNamePair {
  readonly zh: string;
  readonly en: string;
}

const EXACT_NAME_DICTIONARY_PAIRS = [
  { zh: "艾丽西亚·贝内特", en: "Alicia Bennett" },
  { zh: "安德烈·布朗", en: "Andre Brown" },
  { zh: "沙妮丝·坎贝尔", en: "Shanice Campbell" },
  { zh: "德韦恩·摩根", en: "Dwayne Morgan" },
  { zh: "凯莎·汤普森", en: "Keisha Thompson" },
  { zh: "里卡多·威廉姆斯", en: "Ricardo Williams" },
  { zh: "纳丁·克拉克", en: "Nadine Clarke" },
  { zh: "奥马尔·福斯特", en: "Omar Foster" },
  { zh: "坦娅·布莱克", en: "Tanya Blake" },
  { zh: "德尔罗伊·戈登", en: "Delroy Gordon" },
  { zh: "西蒙娜·亨利", en: "Simone Henry" },
  { zh: "柯克·道格拉斯", en: "Kirk Douglas" },
  { zh: "玛西娅·里德", en: "Marcia Reid" },
  { zh: "安东尼·斯图尔特", en: "Anthony Stewart" },
  { zh: "珍妮特·莫里森", en: "Janet Morrison" },
  { zh: "巴林顿·刘易斯", en: "Barrington Lewis" },
  { zh: "科莱特·普赖斯", en: "Collette Pryce" },
  { zh: "德文·麦肯齐", en: "Devon McKenzie" },
  { zh: "阿尔西娅·罗宾逊", en: "Althea Robinson" },
  { zh: "考特尼·贝利", en: "Courtney Bailey" },
  { zh: "伊冯娜·格兰特", en: "Yvonne Grant" },
  { zh: "德韦恩·克拉克", en: "Dwayne Clarke" },
  { zh: "罗谢尔·格兰特", en: "Rochelle Grant" },
  { zh: "陈美玲", en: "Chen Meiling" },
  { zh: "戴维·布莱克", en: "David Blake" },
  { zh: "王小梅", en: "Wang Xiaomei" },
  { zh: "安东尼·格兰特", en: "Anthony Grant" },
  { zh: "李志强", en: "Li Zhiqiang" },
  { zh: "克里斯托弗·杨", en: "Christopher Young" },
  { zh: "彼得·摩根", en: "Peter Morgan" },
  { zh: "莎拉·威廉姆斯", en: "Sarah Williams" },
  { zh: "迈克尔·史密斯", en: "Michael Smith" },
  { zh: "格雷斯·约翰逊", en: "Grace Johnson" },
] as const satisfies readonly ApprovedFullNamePair[];

/** 审批过的完整姓名对。英文输入只能命中完整规范姓名，绝不按姓氏或旧别名猜测。 */
export const APPROVED_FULL_NAME_PAIRS: readonly ApprovedFullNamePair[] = [
  { zh: "陈志远", en: "Chen Zhiyuan" },
  { zh: "林美华", en: "Lin Meihua" },
  { zh: "黄国强", en: "Huang Guoqiang" },
  { zh: "李秀兰", en: "Li Xiulan" },
  { zh: "张伟明", en: "Zhang Weiming" },
  { zh: "吴雅婷", en: "Wu Yating" },
  { zh: "周建华", en: "Zhou Jianhua" },
  { zh: "郑丽珍", en: "Zheng Lizhen" },
  { zh: "何俊杰", en: "He Junjie" },
  { zh: "罗淑芬", en: "Luo Shufen" },
  ...EXACT_NAME_DICTIONARY_PAIRS,
];

/**
 * 中文源值的例外映射。常规中文姓名仍由离线拼音生成，避免把词典本身误当作音译器。
 */
export const CHINESE_NAME_OVERRIDES: readonly ApprovedFullNamePair[] = EXACT_NAME_DICTIONARY_PAIRS;
