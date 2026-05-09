import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [IntelligenceModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
