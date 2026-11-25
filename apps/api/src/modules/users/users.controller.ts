import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserDto,
  UserPageDto,
} from './users.dto.js';
import { UsersService } from './users.service.js';

const UserId = Param('id', new UuidParamPipe('Usuário'));

@ApiTags('users')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('users')
@RequirePermissions(Permission.USER_MANAGE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: UserPageDto })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: UserDto })
  get(@UserId id: string) {
    return this.users.get(id);
  }

  @Post()
  @ApiCreatedResponse({
    type: UserDto,
    description: 'User must change the password at first login.',
  })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserDto })
  update(@CurrentUser() actor: AuthUser, @UserId id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDto, description: 'Revokes every session of the user.' })
  deactivate(@CurrentUser() actor: AuthUser, @UserId id: string) {
    return this.users.deactivate(actor, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDto })
  activate(@CurrentUser() actor: AuthUser, @UserId id: string) {
    return this.users.activate(actor, id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: UserDto, description: 'Forces a password change and revokes sessions.' })
  resetPassword(@CurrentUser() actor: AuthUser, @UserId id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(actor, id, dto);
  }
}
