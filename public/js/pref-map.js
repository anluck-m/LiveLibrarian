// 都道府県の選択UI用データ。
// 地方ごとにまとめた県名チップで選ぶ（背景の日本地図は使わない方針）。
// 地理的な配置はせず、地方の並び順（北から南）で素直にカードを並べる。

// 地方 → 所属県。ユーザー指定の8地方区分。
const PREF_REGIONS = {
  hokkaido: ['北海道'],
  tohoku: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  kanto: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  chubu: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  kinki: ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  chugoku: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  shikoku: ['徳島県', '香川県', '愛媛県', '高知県'],
  kyushu: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'],
};

// 地方スラッグ → 表示ラベル
const PREF_REGION_LABEL = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  chubu: '中部',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州・沖縄',
};

// 県名 → 地方スラッグ（逆引き）
const PREF_REGION_OF = Object.fromEntries(
  Object.entries(PREF_REGIONS).flatMap(([region, prefs]) => prefs.map((p) => [p, region]))
);

// チップ表示用の短縮名（東京都→東京、北海道はそのまま）
function shortPrefName(name) {
  return name === '北海道' ? name : name.replace(/[都府県]$/, '');
}
