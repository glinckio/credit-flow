import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { ApplicationsController } from './applications.controller.js';
import { IssuesController } from './issues.controller.js';
import { ApplicationsRepository } from './applications.repository.js';
import { ApplicationsService } from './applications.service.js';
import { IssuesService } from './issues.service.js';

@Module({
  imports: [CustomersModule],
  controllers: [ApplicationsController, IssuesController],
  providers: [ApplicationsService, IssuesService, ApplicationsRepository],
  // Documents and analysis modules reuse visibility and the transition pipeline.
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
