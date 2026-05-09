import { Module } from '@nestjs/common';
import { CollectorsModule } from '../collectors/collectors.module';
import { MiniAppController } from './mini-app.controller';

@Module({
  imports: [CollectorsModule],
  controllers: [MiniAppController],
})
export class MiniAppModule {}
