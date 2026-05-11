import { Module } from '@nestjs/common';
import { GiftTelegramLinkResolverService } from './gift-telegram-link-resolver.service';

@Module({
  providers: [GiftTelegramLinkResolverService],
  exports: [GiftTelegramLinkResolverService],
})
export class MrktLinkModule {}
