import type { FootprintsConfig } from "@/types/footprintsConfig";

// 足迹地图配置：到访过的地方标在地图上。
// places 为空时页面显示占位状态，导航栏自动隐藏"足迹"入口；
// 添加地点示例：{ name: "杭州", coords: [30.25, 120.17], date: "2026-05-01", note: "西湖边看日落" }
export const footprintsConfig: FootprintsConfig = {
	// 地图初始中心（默认落在中华人民共和国中部）
	center: [35.86, 104.19],
	defaultZoom: 4,
	places: [],
};
