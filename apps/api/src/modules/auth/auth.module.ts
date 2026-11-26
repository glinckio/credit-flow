import { Global, Module } from '@nestjs/common';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleGuard } from './login-throttle.guard.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AccessGuard, LoginThrottleGuard],
  exports: [SessionService, AccessGuard],
})
export class AuthModule {}
