/**
 * 登場人物の定義。
 *
 * pose は public/chara/<file>.png を指す。
 * 立ち絵は tools/prepare-art.sh で「高さ1200px・足元下端・幅480px」に
 * 正規化済みなので、3D では
 *   height = 1.72m * scale
 *   width  = height * 480 / 1200
 * で板を作れば、足が床に着き、身長差だけが残る。
 */
export const CHARACTERS = {
  ryoma: {
    id: 'ryoma',
    name: '両馬 二郎',
    kana: 'RYOMA JIRO',
    role: '理数科B組 / ✝本質✝の発生源',
    accent: '#ffb35c',
    scale: 1.01,
    poses: {
      normal: 'chr_ryoma_01_tsuujou',
      grin: 'chr_ryoma_02_niyari',
    },
    defaultPose: 'normal',
    bio: '匿名掲示板とグループラインに「これまじ✝本質✝」を投下し続ける男。三重の名前をネットのあらゆる場所に埋め込む。二郎系を週三で食べているが太っていない。',
    quote: '「✝本質✝に目的はない。目的があったら✝本質✝じゃない。」',
    stats: [
      { k: '本質度', v: 98 },
      { k: '語彙力', v: 12 },
      { k: '自演率', v: 71 },
    ],
  },
  mie: {
    id: 'mie',
    name: '三重 県臣',
    kana: 'MIE KENJIN',
    role: '理数科B組 / 否定の守護者',
    accent: '#7fb2ff',
    scale: 0.99,
    poses: {
      normal: 'chr_mie_01_reishou',
      ha: 'chr_mie_02_ha',
      silence: 'chr_mie_04_kimazui_chinmoku',
    },
    defaultPose: 'normal',
    bio: '学期中に推定二十回「は？」と言う。冷笑しているように見えて、実は一番ちゃんと聞いている。名前はインターネットのあちこちに埋め込まれている。',
    quote: '「俺の✝本質✝はない。俺に✝本質✝をつけるな。」',
    stats: [
      { k: '否定力', v: 99 },
      { k: '本質度', v: 3 },
      { k: '傾聴力', v: 88 },
    ],
  },
  terachi: {
    id: 'terachi',
    name: '寺地 星',
    kana: 'TERACHI SEI',
    role: '理数科B組 / 本質配信の配信者',
    accent: '#b48bff',
    scale: 0.99,
    poses: {
      normal: 'chr_terachi_01_nemusou',
      stream: 'chr_terachi_03_haishin_shinken',
    },
    defaultPose: 'normal',
    bio: '登録者百五十人の地理・地学チャンネル「星と地面とせいちちゃんねる」を運営。LINEオープンチャット「✝本質✝募集所」に届いた本質をA4に書き、カメラに見せて読み上げる。',
    quote: '「✝本質✝って、たぶん本当のことに近くて、正しいことには遠い気がする。」',
    stats: [
      { k: '本質受信', v: 91 },
      { k: '語り', v: 64 },
      { k: 'フリーズ', v: 82 },
    ],
  },
  satou: {
    id: 'satou',
    name: '砂糖 東洋',
    kana: 'SATOU TOUYOU',
    role: '理数科B組 / 窓の外を見ない男',
    accent: '#5fe0c0',
    scale: 0.98,
    poses: {
      game: 'chr_satou_01_game_gyoushi',
      look: 'chr_satou_03_kao_ageta',
      camera: 'chr_satou_05_camera',
    },
    defaultPose: 'game',
    bio: '片道一時間十分の通学をゲームに使う。実態のないものに熱狂する行為を見下している。充電が切れた日、初めて窓の外を見た。',
    quote: '「事実を述べただけ」',
    stats: [
      { k: '本質度', v: 47 },
      { k: 'ゲーム', v: 96 },
      { k: '窓の外', v: 5 },
    ],
  },
  rei: {
    id: 'rei',
    name: '零',
    kana: 'REI',
    role: '理数科B組 / 全科目学年首席',
    accent: '#8ad4ff',
    scale: 0.94,
    poses: {
      normal: 'chr_rei_01_suzushii',
      smile: 'chr_rei_02_hohoemi',
    },
    defaultPose: 'normal',
    bio: '全科目学年首席。偏差値八十五。家が近いから理数科にいる、と本人は言う。同じ地図が違う地図になることを、静かに面白がる。',
    quote: '「偶然か✝本質✝かは、たぶん決められないよ。どっちかって言えるほどの根拠がどちらにもないから。」',
    stats: [
      { k: '本質度', v: 74 },
      { k: '学力', v: 100 },
      { k: '観測', v: 93 },
    ],
  },
  izaki: {
    id: 'izaki',
    name: '伊崎',
    kana: 'IZAKI',
    role: '理数科B組 / まとめ役',
    accent: '#ffd166',
    scale: 1.0,
    poses: {
      normal: 'chr_izaki_01_tsuujou',
      smile: 'chr_izaki_02_egao',
    },
    defaultPose: 'normal',
    bio: '三重の「まあ」を二回引き出す人間。教室の力学を、たぶん一番よく知っている。',
    quote: '「俺がやるより面白かった」',
    stats: [
      { k: '本質度', v: 41 },
      { k: '調整力', v: 90 },
      { k: 'ツッコミ', v: 68 },
    ],
  },
  izumi: {
    id: 'izumi',
    name: '伊豆見',
    kana: 'IZUMI',
    role: '理数科B組 / 半歩ずれる',
    accent: '#9be15d',
    scale: 0.97,
    poses: {
      normal: 'chr_izumi_02_egao',
      resolve: 'chr_izumi_04_ketsui',
    },
    defaultPose: 'normal',
    bio: 'ずっと伊崎の横にいた。学年末、大喜利大会の司会を自分でやると決めた。自分で決めた、ということがよかった。',
    quote: '「やったことないけど、やってみたい」',
    stats: [
      { k: '本質度', v: 58 },
      { k: '成長', v: 84 },
      { k: '司会', v: 62 },
    ],
  },
  sakura: {
    id: 'sakura',
    name: '櫻 優',
    kana: 'SAKURA YUU',
    role: '内進二年 / 恋愛学研究者',
    accent: '#ff8fb1',
    scale: 0.99,
    poses: {
      research: 'chr_sakura_02_kenkyuusha',
      smile: 'chr_sakura_05_egao',
    },
    defaultPose: 'research',
    bio: '人間の感情的結合の構造を研究している。サンプルG-07を二ヶ月観察した。ノートは第十三法則で原形を留めていない。',
    quote: '「恋愛とは✝本質✝であり、✝本質✝とは恋愛である。……何を言っているかわからない。助けて。」',
    stats: [
      { k: '本質度', v: 66 },
      { k: '理論', v: 97 },
      { k: '観測回避', v: 88 },
    ],
  },
  naitou: {
    id: 'naitou',
    name: '内藤 蘭',
    kana: 'NAITOU RAN',
    role: '内進二年 / 静かな生徒',
    accent: '#c9b8ff',
    scale: 0.96,
    poses: { normal: 'chr_naitou_02_hohoemi' },
    defaultPose: 'normal',
    bio: '図書室で隣に座っていた。消しゴムを拾った。それだけのことが、櫻のノートを二十七回書き換えさせた。',
    quote: '「なんで二回お礼言うの？」',
    stats: [
      { k: '本質度', v: 80 },
      { k: '静寂', v: 95 },
      { k: '微笑', v: 77 },
    ],
  },
  mitsumine: {
    id: 'mitsumine',
    name: '三峰 瑠衣',
    kana: 'MITSUMINE RUI',
    role: '内進二年 / 常識の塊',
    accent: '#ffa8d8',
    scale: 0.96,
    poses: { normal: 'chr_mitsumine_01_tsuujou' },
    defaultPose: 'normal',
    bio: '恋愛に理論が介在する余地を許さない。櫻にとっては天敵であり、たぶん友人。',
    quote: '「恋愛学」',
    stats: [
      { k: '本質度', v: 35 },
      { k: '常識', v: 100 },
      { k: '行動力', v: 81 },
    ],
  },
  katsuya: {
    id: 'katsuya',
    name: '塀 勝也',
    kana: 'HEI KATSUYA',
    role: '地理教師 / 通称ヘイカツ',
    accent: '#d9c4a3',
    scale: 1.07,
    poses: {
      normal: 'chr_katsuya_02_hohoemi',
      gaze: 'chr_katsuya_03_tooi_me',
    },
    defaultPose: 'normal',
    bio: '地形図を上から描く。授業中に五秒だけ窓の外を見る。その五秒のあいだ、教室は少しだけ静かになる。',
    quote: '「同じ地図だ。一学期に見たのと同じ。でも、お前ら、一学期と同じに見えるか？」',
    stats: [
      { k: '本質度', v: 92 },
      { k: '地理', v: 99 },
      { k: '窓の外', v: 100 },
    ],
  },
  kuraishi: {
    id: 'kuraishi',
    name: '倉石 暁',
    kana: 'KURAISHI AKIRA',
    role: '理数科一年A組 / 新入生',
    accent: '#ff6b6b',
    scale: 0.97,
    poses: {
      normal: 'chr_kuraishi_01_nekkyou',
      shock: 'chr_kuraishi_02_kangeki',
    },
    defaultPose: 'normal',
    bio: 'ノートの表紙にも筆箱にも制服の裏地にも「✝」と書いて入学してきた。趣味は✝本質✝の探求。',
    quote: '「趣味は✝本質✝の探求です」',
    stats: [
      { k: '本質度', v: 87 },
      { k: '熱量', v: 100 },
      { k: '客観', v: 9 },
    ],
  },
  meshino: {
    id: 'meshino',
    name: '召野 カイト',
    kana: 'MESHINO KAITO',
    role: '理数科二年 / 覚醒した男',
    accent: '#ff9f43',
    scale: 1.0,
    poses: { normal: 'chr_meshino_05_eigo_doya' },
    defaultPose: 'normal',
    bio: '二見先生の結婚指輪を見た瞬間、空気から可燃性ガスに変わった。英語の成績は百十八人抜き。',
    quote: '「人妻は美しい。他者に所有されているという事実が輪郭を際立たせている。」',
    stats: [
      { k: '本質度', v: 52 },
      { k: '英語', v: 88 },
      { k: '危険度', v: 73 },
    ],
  },
  futami: {
    id: 'futami',
    name: '二見 玲子',
    kana: 'FUTAMI REIKO',
    role: '英語教師 / 副担任',
    accent: '#ffcf8a',
    scale: 1.03,
    poses: { normal: 'chr_futami_01_tsuujou' },
    defaultPose: 'normal',
    bio: '明るい声。笑顔。ショートカット。三十二歳。左手薬指に銀の結婚指輪。',
    quote: '「すごい、召野くん」',
    stats: [
      { k: '本質度', v: 61 },
      { k: '英語', v: 94 },
      { k: '既婚', v: 100 },
    ],
  },
};

/**
 * 立ち位置（教室座標・メートル）。
 *   ry: 0 = 黑板（+Z）を向く / 180 = 教室の後ろ（-Z）を向く / 90 = 窓（+X）を向く
 * 座標は classroom.glb の実寸（机の列・窓・教卓・自販機）に合わせてある。
 */
export const SPOTS = {
  // 机の間の通路（A列：廊下側 / C列：窓側）
  A1: { x: -1.75, z: -3.05, ry: 7 },
  A2: { x: -1.75, z: -0.55, ry: 10 },
  A3: { x: 0.13, z: -3.15, ry: 4 },
  A4: { x: 0.13, z: 0.25, ry: 6 },
  A5: { x: 1.94, z: -1.25, ry: 2 },
  A6: { x: 1.94, z: 1.70, ry: 10 },
  // 窓際
  W1: { x: 3.30, z: -3.40, ry: 58 },
  W2: { x: 3.32, z: 0.55, ry: 52 },
  // 後ろの隅
  BK1: { x: -2.55, z: -4.30, ry: 150 },
  BK2: { x: 2.15, z: -4.35, ry: 205 },
  // 廊下側の戸口
  D1: { x: -3.32, z: 3.05, ry: 118 },
  // 教壇まわり
  B1: { x: -1.45, z: 4.15, ry: 180 },
  P1: { x: 0.55, z: 2.66, ry: 0 },
  C1: { x: 0.92, z: 2.62, ry: 178 },
  C2: { x: -1.08, z: 2.66, ry: 184 },
  C3: { x: -2.40, z: 2.52, ry: 162 },
  C4: { x: 2.88, z: 2.58, ry: 196 },
  // 自販機前
  VM: { x: -3.02, z: 2.55, ry: 92 },
  VM2: { x: -2.62, z: 1.05, ry: 88 },
};
