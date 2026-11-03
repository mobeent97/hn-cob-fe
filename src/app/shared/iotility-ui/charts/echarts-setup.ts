/*
 * The only file that pulls in ECharts. It is loaded with a dynamic import from ChartCanvas,
 * so the library lands in its own chunk and is fetched the first time a chart renders.
 * Register only what the chart components use to keep that chunk small.
 */
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

use([BarChart, LineChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export { init };
