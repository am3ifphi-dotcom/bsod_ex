export type Credit = {
  name: string;
  author: string;
  license: string;
  url: string;
  used: string;
};

/** 実際に取得・変換して同梱しているアセットのみを記載 (ライセンスは各自確認済み) */
export const CREDITS: Credit[] = [
  {
    name: 'Sheen Wood Leather Sofa',
    author: 'Fran Calvente (CC0 original) / Eric Chadwick, Darmstadt Graphics Group (CC-BY-4.0 improvements)',
    license: 'CC0-1.0 + CC-BY-4.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenWoodLeatherSofa',
    used: '異世界に浮遊する家具の断片',
  },
  {
    name: 'Sheen Chair',
    author: 'Eric Chadwick / Wayfair, LLC',
    license: 'CC0-1.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair',
    used: '自室の椅子 / 異世界の断片',
  },
  {
    name: 'Lantern',
    author: 'Khronos glTF Sample Assets contributors',
    license: 'CC0-1.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern',
    used: '自室のフロアランプ / 異世界の断片',
  },
  {
    name: 'Water Bottle',
    author: 'Microsoft (CC0)',
    license: 'CC0-1.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle',
    used: '机の上の小物',
  },
  {
    name: 'Diffuse Transmission Plant',
    author: 'Rico Cilliers (CC0) / Eric Chadwick, DGG (CC-BY-4.0)',
    license: 'CC0-1.0 + CC-BY-4.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DiffuseTransmissionPlant',
    used: '自室の観葉植物',
  },
  {
    name: 'Glass Vase with Flowers',
    author: 'Eric Chadwick / Rico Cilliers',
    license: 'CC0-1.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlassVaseFlowers',
    used: '棚の花瓶',
  },
  {
    name: 'Toy Car',
    author: 'Guido Odendahl / Eric Chadwick',
    license: 'CC0-1.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar',
    used: '棚のミニカー',
  },
  {
    name: 'Pot of Coals',
    author: 'Eric Chadwick / Darmstadt Graphics Group',
    license: 'CC-BY-4.0',
    url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/PotOfCoals',
    used: 'サイドテーブルの鉢',
  },
  {
    name: 'PBR textures (Wood / Plaster / Concrete / Brick / Metal / Asphalt / Rock / Ground)',
    author: 'ambientCG (via petroulacl/fps-asset-kit mirror)',
    license: 'CC0-1.0',
    url: 'https://ambientcg.com/',
    used: '自室・異世界の全サーフェス (1024px WebP + ORM パックに変換)',
  },
  {
    name: "Fantozzi's Footsteps",
    author: 'Fantozzi (via OpenGameArt / petroulacl mirror)',
    license: 'CC0-1.0',
    url: 'https://opengameart.org/content/fantozzis-footsteps-grasssand-stone',
    used: '足音',
  },
  {
    name: 'three.js r186 / addons',
    author: 'three.js authors',
    license: 'MIT',
    url: 'https://threejs.org/',
    used: 'レンダリング / ポストエフェクト / glTF ローディング',
  },
  {
    name: 'RoomEnvironment (procedural studio environment)',
    author: 'three.js authors',
    license: 'MIT',
    url: 'https://github.com/mrdoob/three.js',
    used: '反射プローブ (IBL) の生成',
  },
  {
    name: '合成音 (環境音・グリッチ・崩壊・落下・帰還)',
    author: '本作のために Web Audio API でリアルタイム合成',
    license: 'CC0 / 本作オリジナル',
    url: '—',
    used: 'BGM 以外の全効果音・環境音・残響 IR',
  },
  {
    name: '手続き生成テクスチャ (BSOD 画面 / エラー文字 / 破損 UI / 夜景 / 顔)',
    author: '本作オリジナル (Canvas2D で実行時生成)',
    license: '本作オリジナル',
    url: '—',
    used: '画面内 UI・異世界のディテール',
  },
];

export const LICENSE_NOTES = [
  'CC-BY-4.0 の素材はクレジット表記により利用しています。改変 (再マテリアル化・量子化・WebP 変換) を行っています。',
  'NC (非商用) 素材は本作には使用していません。すべて CC0 / CC-BY-4.0 / MIT / 自作です。',
  'すべての素材は assets-src/ に取得し、scripts/build-assets.mjs で再生成できます。',
];
