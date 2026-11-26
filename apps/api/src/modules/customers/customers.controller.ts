import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerPageDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './customers.dto.js';
import { CustomersService } from './customers.service.js';

const CustomerId = Param('id', new UuidParamPipe('Cliente'));

@ApiTags('customers')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMER_READ)
  @ApiOkResponse({ type: CustomerPageDto })
  list(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMER_READ)
  @ApiOkResponse({ type: CustomerDto })
  get(@CustomerId id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMER_WRITE)
  @ApiCreatedResponse({ type: CustomerDto })
  @ApiConflictResponse({ description: 'CPF/CNPJ já cadastrado (`existingCustomerId`).' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CUSTOMER_WRITE)
  @ApiOkResponse({ type: CustomerDto })
  @ApiConflictResponse({ description: '`version` desatualizada.' })
  update(@CurrentUser() actor: AuthUser, @CustomerId id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(actor, id, dto);
  }
}
