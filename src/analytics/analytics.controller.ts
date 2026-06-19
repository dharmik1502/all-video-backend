import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('platforms')
  getPlatformStats() {
    return this.analyticsService.getPlatformStats();
  }

  @Get('daily')
  getDailyStats(@Query('days') days = '7') {
    return this.analyticsService.getDailyStats(parseInt(days));
  }
}
