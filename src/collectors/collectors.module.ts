import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { EventsModule } from '../events/events.module';
import { MrktCollector } from './mrkt/mrkt.collector';
import { MrktApiService } from './mrkt/mrkt-api.service';
import { PortalsCollector } from './portals/portals.collector';
import { TonnelCollector } from './tonnel/tonnel.collector';

@Module({
  imports: [EventsModule, AlertsModule],
  providers: [MrktApiService, MrktCollector, TonnelCollector, PortalsCollector],
})
export class CollectorsModule {}
