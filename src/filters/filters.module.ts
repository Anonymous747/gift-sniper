import { Module } from '@nestjs/common';
import { FilterEngineService } from './filter-engine.service';

@Module({
  providers: [FilterEngineService],
  exports: [FilterEngineService],
})
export class FiltersModule {}
