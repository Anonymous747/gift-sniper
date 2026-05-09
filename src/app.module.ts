import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { CollectorsModule } from './collectors/collectors.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { FiltersModule } from './filters/filters.module';
import { AlertsModule } from './alerts/alerts.module';
import { BotModule } from './bot/bot.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    RedisModule,
    EventsModule,
    IngestionModule,
    CollectorsModule,
    PipelineModule,
    FiltersModule,
    AlertsModule,
    BotModule,
    HealthModule,
  ],
})
export class AppModule {}
