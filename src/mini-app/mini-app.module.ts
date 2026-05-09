import { Module } from '@nestjs/common';
import { MiniAppController } from './mini-app.controller';

@Module({
  controllers: [MiniAppController],
})
export class MiniAppModule {}
