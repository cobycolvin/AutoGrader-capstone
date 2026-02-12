import uuid

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class CreatedByModel(models.Model):
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_%(class)s_set',
    )

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimeStampedModel, CreatedByModel):
    class Meta:
        abstract = True


class OrganizationRole(models.TextChoices):
    ADMIN = 'ADMIN', 'Admin'
    SUPPORT = 'SUPPORT', 'Support'


class UserProfile(BaseModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    display_name = models.CharField(max_length=200, blank=True)
    first_name = models.CharField(max_length=150)
    middle_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150)
    cwid = models.CharField(max_length=32, unique=True)
    canvas_user_id = models.CharField(max_length=100, blank=True, null=True)
    timezone = models.CharField(max_length=64, blank=True)

    def __str__(self):
        if self.display_name:
            return self.display_name
        full_name = " ".join(part for part in [self.first_name, self.middle_name, self.last_name] if part)
        return full_name or self.user.get_username()


class Organization(BaseModel):
    name = models.CharField(max_length=200)
    domain = models.CharField(max_length=255, blank=True, null=True, unique=True)

    def __str__(self):
        return self.name


class OrganizationMembership(BaseModel):
    org = models.ForeignKey(Organization, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    org_role = models.CharField(max_length=20, choices=OrganizationRole.choices)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['org', 'user'], name='uniq_org_user'),
        ]
