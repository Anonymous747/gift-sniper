import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MrktCollector } from './mrkt/mrkt.collector';
import { MrktApiService } from './mrkt/mrkt-api.service';

@Module({
  imports: [EventsModule],
  providers: [MrktApiService, MrktCollector],
})
export class CollectorsModule {}
