import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AllowPasswordChangePending,
  Authenticated,
  CurrentUser,
  Public,
} from './access.decorators.js';
import { ChangePasswordDto, LoginDto } from './auth.dto.js';
import { type AuthUser, AuthUserResponseDto } from './auth-user.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleGuard } from './login-throttle.guard.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @Public()
  @UseGuards(LoginThrottleGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: AuthUserResponseDto, description: 'Sets the httpOnly session cookie.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials (same answer for every cause).' })
  @ApiTooManyRequestsResponse()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponseDto> {
    const { token, user } = await this.auth.login(
      dto.email,
      dto.password,
      req.headers['user-agent'],
    );
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return { user };
  }

  @Post('logout')
  @Authenticated()
  @AllowPasswordChangePending()
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiNoContentResponse()
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, req.sessionId!);
    res.clearCookie(SESSION_COOKIE, { ...this.sessions.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  @Authenticated()
  @AllowPasswordChangePending()
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ type: AuthUserResponseDto })
  me(@CurrentUser() user: AuthUser): AuthUserResponseDto {
    return { user };
  }

  @Post('change-password')
  @Authenticated()
  @AllowPasswordChangePending()
  @HttpCode(200)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ type: AuthUserResponseDto, description: 'Other sessions are revoked.' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<AuthUserResponseDto> {
    const updated = await this.auth.changePassword(
      user,
      req.sessionId!,
      dto.currentPassword,
      dto.newPassword,
    );
    return { user: updated };
  }
}
