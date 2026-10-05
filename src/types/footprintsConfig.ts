// 足迹地图数据类型
export interface FootprintPlace {
	// 地点名称
	name: string;
	// 经纬度 [纬度, 经度]
	coords: [number, number];
	// 到访日期，格式 YYYY-MM-DD（可选）
	date?: string;
	// 一句话备注（可选）
	note?: string;
}

export interface FootprintsConfig {
	// 地图初始中心 [纬度, 经度]
	center: [number, number];
	// 初始缩放级别（3=世界，5=国家，10=城市）
	defaultZoom: number;
	// 到访过的地点列表；为空数组时页面显示占位状态，导航栏也会自动隐藏
	places: FootprintPlace[];
}
